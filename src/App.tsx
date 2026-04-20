import React, { useState, useEffect, useMemo } from 'react';
import { db, auth } from './firebase';
import { 
  collection, 
  onSnapshot, 
  doc, 
  writeBatch,
  query, 
  where,
  Timestamp,
  deleteDoc,
  getDocs,
  updateDoc
} from 'firebase/firestore';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider,
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { Theater, Seat, Reservation, Project } from './types';
import { SeatMap } from './components/SeatMap';
import { AdminPanel } from './components/AdminPanel';
import { 
  Film, 
  LogOut, 
  Settings, 
  User as UserIcon, 
  Check, 
  X,
  ChevronRight,
  Info,
  Trash2,
  Download,
  Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import * as XLSX from 'xlsx';

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  const [theaters, setTheaters] = useState<Theater[]>([]);
  const [selectedTheater, setSelectedTheater] = useState<Theater | null>(null);
  const [reservations, setReservations] = useState<Record<string, Reservation>>({});
  
  const [userName, setUserName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [phone, setPhone] = useState('');
  const [searchPhone, setSearchPhone] = useState('');
  const [searchResults, setSearchResults] = useState<Reservation[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedSeats, setSelectedSeats] = useState<Seat[]>([]);
  const [isReserving, setIsReserving] = useState(false);
  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
  const [editForm, setEditForm] = useState({ userName: '', groupName: '', phoneLast4: '' });
  const [moveTargetTheaterId, setMoveTargetTheaterId] = useState('');

  const handleMoveToAnotherTheater = async () => {
    if (!editingReservation || !selectedTheater || !moveTargetTheaterId || !selectedProject) return;
    
    const targetTheater = theaters.find(t => t.id === moveTargetTheaterId);
    if (!targetTheater) return;

    try {
      let reservationsToMove: Reservation[] = [];
      if (editingReservation.groupName) {
        reservationsToMove = Object.values(reservations).filter(r => (r as Reservation).groupName === editingReservation.groupName) as Reservation[];
      } else {
        reservationsToMove = [editingReservation];
      }

      const targetReservationsSnap = await getDocs(query(
        collection(db, 'reservations'), 
        where('projectId', '==', selectedProject.id),
        where('theaterId', '==', moveTargetTheaterId)
      ));
      const reservedIds = new Set(targetReservationsSnap.docs.map(d => (d.data() as Reservation).seatId));
      
      const availableSeats = (Object.values(targetTheater.seats) as Seat[]).filter(s => s.type !== 'empty' && !reservedIds.has(s.id));
      
      if (availableSeats.length < reservationsToMove.length) {
        showAlert(`이동하려는 관에 빈 좌석이 부족합니다. (필요: ${reservationsToMove.length}석, 남은 좌석: ${availableSeats.length}석)`);
        return;
      }

      const rowLabels = Array.from(new Set((Object.values(targetTheater.seats) as Seat[]).map(s => s.row))).sort();
      const centerRowIdx = Math.floor(rowLabels.length / 2);
      const centerCol = Math.floor(targetTheater.cols / 2);
      
      const scoredSeats = availableSeats.map(s => {
          const rowIdx = rowLabels.indexOf(s.row);
          const score = Math.pow(rowIdx - centerRowIdx, 2) * 2 + Math.pow(s.col - centerCol, 2);
          return { seat: s, score };
      });
      
      const rowsOfSeats: Record<string, { seat: Seat; score: number }[]> = {};
      scoredSeats.forEach(ss => {
        if (!rowsOfSeats[ss.seat.row]) rowsOfSeats[ss.seat.row] = [];
        rowsOfSeats[ss.seat.row].push(ss);
      });
      Object.values(rowsOfSeats).forEach(rList => rList.sort((a, b) => a.seat.col - b.seat.col));

      const count = reservationsToMove.length;
      let bestBlock: Seat[] = [];
      let bestScore = Infinity;
      
      for (const rList of Object.values(rowsOfSeats)) {
          for (let i = 0; i <= rList.length - count; i++) {
              const block = rList.slice(i, i + count);
              let contiguous = true;
              let blockScore = 0;
              for (let j = 0; j < block.length; j++) {
                  blockScore += block[j].score;
                  if (j > 0 && block[j].seat.col - block[j - 1].seat.col !== 1) {
                      contiguous = false; break;
                  }
              }
              if (contiguous && blockScore < bestScore) {
                  bestScore = blockScore;
                  bestBlock = block.map(b => b.seat);
              }
          }
      }

      if (bestBlock.length === 0) {
          bestBlock = scoredSeats.sort((a, b) => a.score - b.score).slice(0, count).map(b => b.seat);
      }

      const batch = writeBatch(db);
      
      for (let i = 0; i < count; i++) {
        const oldRes = reservationsToMove[i];
        const newSeat = bestBlock[i];
        
        const oldRef = doc(db, 'reservations', `${selectedProject.id}_${selectedTheater.id}_${oldRes.seatId}`);
        batch.delete(oldRef);

        const newRef = doc(db, 'reservations', `${selectedProject.id}_${targetTheater.id}_${newSeat.id}`);
        batch.set(newRef, {
          projectId: selectedProject.id,
          theaterId: targetTheater.id,
          seatId: newSeat.id,
          userName: oldRes.userName,
          groupName: oldRes.groupName || '',
          phoneLast4: oldRes.phoneLast4 || '',
          reservedAt: oldRes.reservedAt
        });
      }

      await batch.commit();
      showAlert(`[${targetTheater.name}] 관으로 예약을 자동 배정하여 총 ${count}석을 이동시켰습니다.`);
      setEditingReservation(null);
      setMoveTargetTheaterId('');
    } catch(e: any) {
      showAlert(`이동 중 오류 발생: ${e.message}`);
    }
  };

  const groupedTheaters = useMemo(() => {
    const groups: Record<string, Theater[]> = {};
    theaters.forEach(t => {
      const branch = t.branch || '기타 상영관';
      if (!groups[branch]) groups[branch] = [];
      groups[branch].push(t);
    });

    Object.values(groups).forEach(group => {
      group.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
    });

    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [theaters]);

  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    type: 'alert' | 'confirm';
    message: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  } | null>(null);

  const showAlert = (message: string) => {
    setDialog({ isOpen: true, type: 'alert', message });
  };

  const showConfirm = (message: string, onConfirm: () => void, onCancel?: () => void) => {
    setDialog({ isOpen: true, type: 'confirm', message, onConfirm, onCancel });
  };

  const handleSelectionDrop = (sourceSeatId: string, targetSeatId: string) => {
    if (!selectedTheater || selectedSeats.length === 0) return;
    const sourceSeat = selectedTheater.seats[sourceSeatId];
    const targetSeat = selectedTheater.seats[targetSeatId];
    if (!sourceSeat || !targetSeat) return;

    const rowLabels = Array.from(new Set(Object.values(selectedTheater.seats).map(s => (s as Seat).row))).sort();
    const sourceRowIdx = rowLabels.indexOf(sourceSeat.row);
    const targetRowIdx = rowLabels.indexOf(targetSeat.row);
    const rowOffset = targetRowIdx - sourceRowIdx;
    const colOffset = targetSeat.col - sourceSeat.col;

    const newSelected: Seat[] = [];
    for (const s of selectedSeats) {
      const sRowIdx = rowLabels.indexOf(s.row);
      const newRowIdx = sRowIdx + rowOffset;
      if (newRowIdx < 0 || newRowIdx >= rowLabels.length) {
        showAlert('해당 위치로는 옮길 수 없습니다. (좌석 이탈)');
        return;
      }
      const newRow = rowLabels[newRowIdx];
      const newCol = s.col + colOffset;
      const newSeatId = `${newRow}-${newCol}`;
      const newSeat = selectedTheater.seats[newSeatId];

      if (!newSeat || newSeat.type === 'empty' || reservations[newSeatId]) {
        showAlert('이동하려는 범위에 유효하지 않거나 예약된 좌석이 포함되어 있습니다.');
        return;
      }
      newSelected.push(newSeat);
    }
    setSelectedSeats(newSelected);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAdmin(u?.email === 'mcfly0803@gmail.com');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'projects'), (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Project));
      docs.sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
      setProjects(docs);
      if (docs.length > 0 && !selectedProject) {
        setSelectedProject(docs[0]);
      }
    });
    return () => unsubscribe();
  }, [selectedProject]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'theaters'), (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Theater));
      setTheaters(docs);
      if (docs.length > 0 && !selectedTheater) {
        setSelectedTheater(docs[0]);
      }
    });
    return () => unsubscribe();
  }, [selectedTheater]);

  useEffect(() => {
    if (!selectedTheater || !selectedProject) {
      setReservations({});
      return;
    }
    
    setSelectedSeats([]);

    const q = query(collection(db, 'reservations'), 
      where('theaterId', '==', selectedTheater.id),
      where('projectId', '==', selectedProject.id)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const resMap: Record<string, Reservation> = {};
      snapshot.docs.forEach(d => {
        const data = d.data() as Reservation;
        resMap[data.seatId] = { id: d.id, ...data };
      });
      setReservations(resMap);
    });
    return () => unsubscribe();
  }, [selectedTheater, selectedProject]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleReserve = async () => {
    // 🔥 침묵의 에러 1: 프로젝트 미선택 시 경고 팝업 추가
    if (!selectedProject) {
      showAlert("상단 우측에서 예약을 저장할 '새 프로젝트'(예: 어벤져스 시사회)를 먼저 선택하거나 만들어주세요.");
      return;
    }

    if (!selectedTheater || selectedSeats.length === 0 || !userName) return;
    
    setIsReserving(true);
    try {
      const batch = writeBatch(db);
      
      selectedSeats.forEach(seat => {
        const reservationId = `${selectedProject.id}_${selectedTheater.id}_${seat.id}`;
        const ref = doc(db, 'reservations', reservationId);
          batch.set(ref, {
            projectId: selectedProject.id,
            theaterId: selectedTheater.id,
            seatId: seat.id,
            userName: userName,
            groupName: groupName,
            phoneLast4: phone.slice(-4),
            reservedAt: Timestamp.now()
          });
      });
      
      await batch.commit();
      setSelectedSeats([]);
    } catch (err: any) {
      console.error(err);
      showAlert(`예약 중 오류가 발생했습니다: ${err.message}`);
    } finally {
      setIsReserving(false);
    }
  };

  const handleDeleteTheater = async (theaterId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAdmin) {
      showAlert("관리자 권한이 필요합니다.");
      return;
    }
    
    showConfirm('이 상영관과 관련된 모든 좌석 데이터와 예약을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.', async () => {
      try {
        const q = query(collection(db, 'reservations'), where('theaterId', '==', theaterId));
        const snapshot = await getDocs(q);
        
        const chunks = [];
        for (let i = 0; i < snapshot.docs.length; i += 500) {
          chunks.push(snapshot.docs.slice(i, i + 500));
        }
        
        for (const chunk of chunks) {
          const batch = writeBatch(db);
          chunk.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
        
        await deleteDoc(doc(db, 'theaters', theaterId));
        
        if (selectedTheater?.id === theaterId) {
          setSelectedTheater(null);
        }
      } catch (err: any) {
        console.error('Error deleting theater:', err);
        showAlert(`삭제 중 오류가 발생했습니다: ${err.message}`);
      }
    });
  };

  const handleUpdateReservation = async () => {
    if (!editingReservation || !selectedTheater || !selectedProject) return;
    try {
      const ref = doc(db, 'reservations', `${selectedProject.id}_${selectedTheater.id}_${editingReservation.seatId}`);
      await updateDoc(ref, {
        userName: editForm.userName,
        groupName: editForm.groupName,
        phoneLast4: editForm.phoneLast4
      });
      setEditingReservation(null);
    } catch(e: any) {
      showAlert(`수정 중 오류가 발생했습니다: ${e.message}`);
    }
  };

  const handleCancelSingle = () => {
    if (!editingReservation || !selectedProject) return;
    showConfirm(`[${editingReservation.seatId}] 예약을 취소하시겠습니까?`, async () => {
      try {
        const ref = doc(db, 'reservations', `${selectedProject.id}_${selectedTheater?.id}_${editingReservation.seatId}`);
        await deleteDoc(ref);
        setEditingReservation(null);
      } catch(e: any) {
        showAlert(`취소에 실패했습니다: ${e.message}`);
      }
    });
  };

  const handleCancelGroup = () => {
    if (!editingReservation || !editingReservation.groupName || !selectedProject) return;
    showConfirm(`그룹 [${editingReservation.groupName}] 전체 예약을 취소하시겠습니까?`, async () => {
      try {
        const batch = writeBatch(db);
        Object.values(reservations).forEach((res) => {
          if ((res as Reservation).groupName === editingReservation.groupName) {
            const ref = doc(db, 'reservations', `${selectedProject.id}_${selectedTheater?.id}_${(res as Reservation).seatId}`);
            batch.delete(ref);
          }
        });
        await batch.commit();
        setEditingReservation(null);
      } catch(e: any) {
        showAlert(`그룹 취소에 실패했습니다: ${e.message}`);
      }
    });
  };

  const handleExportCSV = () => {
    if (!selectedTheater) return;
    const csvRows = [];
    const colIndices = Array.from({ length: selectedTheater.cols }, (_, i) => i + 1);
    
    const header = ['열\\번호', ...colIndices.map(String)];
    csvRows.push(header);
    
    const rowLabels = Array.from(new Set(Object.values(selectedTheater.seats).map(s => (s as Seat).row))).sort();
    
    rowLabels.forEach(row => {
      const rowData = [row];
      colIndices.forEach(col => {
        const seatId = `${row}-${col}`;
        const seat = selectedTheater.seats[seatId];
        const res = reservations[seatId];
        
        if (!seat || seat.type === 'empty') {
          rowData.push('');
        } else if (res) {
          const groupPrefix = res.groupName ? `[${res.groupName}] ` : '';
          const text = `${groupPrefix}${res.userName}`;
          rowData.push(`"${text.replace(/"/g, '""')}"`);
        } else {
          rowData.push('빈좌석');
        }
      });
      csvRows.push(rowData);
    });
    
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + csvRows.map(e => e.join(',')).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `좌석배치표_${selectedTheater.name}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSeatClick = (seat: Seat) => {
    if (reservations[seat.id]) {
      if (isAdmin) {
        const res = reservations[seat.id];
        setEditingReservation(res);
        setEditForm({ userName: res.userName, groupName: res.groupName || '', phoneLast4: res.phoneLast4 || '' });
      }
      return;
    }

    setSelectedSeats(prev => {
      const exists = prev.find(s => s.id === seat.id);
      if (exists) return prev.filter(s => s.id !== seat.id);
      return [...prev, seat];
    });
  };

  // 🔥 엑셀 자동 배정 메인 함수 (에러 수정판)
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    // 🔥 침묵의 에러 2: input 이벤트를 저장해두어 나중에 초기화할 수 있게 함
    const targetInput = e.target;
    const file = targetInput.files?.[0];
    
    if (!file) return; // 파일 선택 창에서 취소했을 경우

    if (!selectedProject) {
      showAlert("상단 우측에서 '새 프로젝트'(예: 어벤져스 시사회)를 먼저 선택하거나 만들어주세요.");
      targetInput.value = ''; // 상태 초기화 (다시 클릭 가능하게)
      return;
    }

    if (!selectedTheater) {
      showAlert("좌측에서 엑셀 명단을 배정할 '상영관'을 먼저 선택해주세요.");
      targetInput.value = '';
      return;
    }

    showConfirm(
      `[${selectedTheater.name}] 관에 빈 좌석을 찾아 자동으로 배치합니다.\n기존 예약을 보존하며 남은 자리에만 들어갑니다.\n계속하시겠습니까?`, 
      () => {
        const reader = new FileReader();
        reader.onload = async (evt) => {
          try {
            const arrayBuffer = evt.target?.result as ArrayBuffer;
            const wb = XLSX.read(arrayBuffer, { type: 'array' });
            const wsname = wb.SheetNames[0];
            const ws = wb.Sheets[wsname];
            const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
            
            const rows = data.slice(1).filter(r => r[0] || r[1]); 
            
            if (rows.length === 0) {
              showAlert("엑셀 파일에 유효한 데이터(이름, 좌석 등)가 없습니다. 양식을 확인해주세요.");
              return;
            }

            interface Request { groupName: string; name: string; priority: number; phone: string; count: number; }
            const requests: Request[] = rows.map(r => ({
              groupName: String(r[0] || '').trim(),
              name: String(r[1] || '').trim(),
              priority: parseInt(r[2]) || 1, 
              phone: String(r[3] || '').replace(/[^0-9]/g, '').slice(-4),
              count: parseInt(r[4]) || 1
            }));
            
            type GroupObj = { priority: number; members: Request[]; totalCount: number; name: string; };
            const groupsObj: Record<string, GroupObj> = {};
            requests.forEach(req => {
              const gName = req.groupName || req.name || '미지정그룹';
              if (!groupsObj[gName]) groupsObj[gName] = { priority: req.priority, members: [], totalCount: 0, name: gName };
              groupsObj[gName].priority = Math.max(groupsObj[gName].priority, req.priority); 
              groupsObj[gName].members.push(req);
              groupsObj[gName].totalCount += req.count;
            });

            const sortedGroups = Object.values(groupsObj)
              .sort((a, b) => b.priority - a.priority || b.totalCount - a.totalCount);

            const availableSeats = (Object.values(selectedTheater.seats) as Seat[]).filter(s => s.type !== 'empty' && !reservations[s.id]);
            
            const rowLabels = Array.from(new Set((Object.values(selectedTheater.seats) as Seat[]).map(s => s.row))).sort();
            const centerRowIdx = Math.floor(rowLabels.length / 2);
            const centerCol = Math.floor(selectedTheater.cols / 2);
            
            const scoredSeats = availableSeats.map(s => {
              const rowIdx = rowLabels.indexOf(s.row);
              const score = Math.pow(rowIdx - centerRowIdx, 2) * 2 + Math.pow(s.col - centerCol, 2); 
              return { seat: s, score };
            });

            // 🔥 파이어베이스 500개 제한 우회를 위한 다중 배치(Chunk Batch) 적용
            const batches = [writeBatch(db)];
            let currentBatchIndex = 0;
            let opCount = 0;
            let placedCount = 0;
            let failCount = 0;

            const rowsOfSeats: Record<string, { seat: Seat; score: number }[]> = {};
            scoredSeats.forEach(ss => {
              if (!rowsOfSeats[ss.seat.row]) rowsOfSeats[ss.seat.row] = [];
              rowsOfSeats[ss.seat.row].push(ss);
            });
            Object.values(rowsOfSeats).forEach(rList => rList.sort((a, b) => a.seat.col - b.seat.col));
            
            const usedSeatIds = new Set<string>();

            const placeGroup = (count: number) => {
                let bestBlock: Seat[] = [];
                let bestScore = Infinity;
                
                for (const rList of Object.values(rowsOfSeats)) {
                    for (let i = 0; i <= rList.length - count; i++) {
                        const block = rList.slice(i, i + count);
                        let contiguous = true;
                        let blockScore = 0;
                        for (let j = 0; j < block.length; j++) {
                            if (usedSeatIds.has(block[j].seat.id)) { contiguous = false; break; }
                            blockScore += block[j].score;
                            if (j > 0 && block[j].seat.col - block[j - 1].seat.col !== 1) {
                                contiguous = false; break;
                            }
                        }
                        if (contiguous && blockScore < bestScore) {
                            bestScore = blockScore;
                            bestBlock = block.map(b => b.seat);
                        }
                    }
                }

                if (bestBlock.length === 0) {
                    const available = scoredSeats.filter(ss => !usedSeatIds.has(ss.seat.id)).sort((a, b) => a.score - b.score);
                    if (available.length >= count) {
                        bestBlock = available.slice(0, count).map(a => a.seat);
                    }
                }
                
                return bestBlock;
            };

            sortedGroups.forEach(group => {
                const seats = placeGroup(group.totalCount);
                if (seats.length < group.totalCount) {
                    failCount += group.totalCount;
                    return;
                }
                
                let seatIdx = 0;
                group.members.forEach(req => {
                    for(let c=0; c<req.count; c++) {
                        const assignedSeat = seats[seatIdx];
                        usedSeatIds.add(assignedSeat.id);
                        
                        const reservationId = `${selectedProject.id}_${selectedTheater.id}_${assignedSeat.id}`;
                        
                        // 500개 제한이 다가오면 새로운 배치(묶음) 생성
                        if (opCount >= 490) {
                            batches.push(writeBatch(db));
                            currentBatchIndex++;
                            opCount = 0;
                        }
                        
                        batches[currentBatchIndex].set(doc(db, 'reservations', reservationId), {
                            projectId: selectedProject.id,
                            theaterId: selectedTheater.id,
                            seatId: assignedSeat.id,
                            userName: req.name || `${group.name}의 멤버 ${c+1}`,
                            groupName: req.groupName || group.name,
                            phoneLast4: req.phone,
                            reservedAt: Timestamp.now()
                        });
                        
                        opCount++;
                        seatIdx++;
                        placedCount++;
                    }
                });
            });

            // 쪼개진 모든 배치들 서버에 일괄 전송
            for (const b of batches) {
                await b.commit();
            }

            showAlert(`배치 완료! 총 ${placedCount}명을 배치했습니다.` + (failCount > 0 ? `\n좌석 부족으로 ${failCount}명이 배치되지 못했습니다.` : ''));
          } catch(err: any) {
            console.error(err);
            showAlert(`엑셀 처리 중 오류가 발생했습니다: ${err.message}`);
          } finally {
            targetInput.value = ''; // 에러가 나든 성공하든 무조건 input 값 비워주기 (다음번 클릭이 가능하도록)
          }
        };
        
        reader.readAsArrayBuffer(file);
      },
      // 취소 버튼을 눌렀을 때도 input 비워주기
      () => {
        targetInput.value = '';
      }
    );
  };

  const handleCheckReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (searchPhone.length < 4 || !selectedProject) {
      if (!selectedProject) showAlert("배정 조회를 위한 프로젝트가 선택되지 않았습니다.");
      else showAlert("휴대폰 번호 뒷자리 4자리를 정확히 입력해주세요.");
      return;
    }
    
    setIsSearching(true);
    try {
      const q = query(
        collection(db, 'reservations'), 
        where('projectId', '==', selectedProject.id),
        where('phoneLast4', '==', searchPhone)
      );
      const snap = await getDocs(q);
      const results = snap.docs.map(d => ({ id: d.id, ...d.data() } as Reservation));
      setSearchResults(results);
    } catch(err: any) {
      showAlert(`조회 중 오류가 발생했습니다: ${err.message}`);
    } finally {
      setIsSearching(false);
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      const ref = doc(collection(db, 'projects'));
      const batch2 = writeBatch(db);
      batch2.set(ref, { name: newProjectName.trim(), createdAt: Timestamp.now() });
      await batch2.commit();
      setNewProjectName('');
      setShowProjectModal(false);
    } catch(e: any) {
      showAlert(`프로젝트 생성 실패: ${e.message}`);
    }
  };

  const handleUpdateProjectName = async () => {
    if (!selectedProject) return;
    const newName = prompt('새 프로젝트 이름을 입력하세요', selectedProject.name);
    if (!newName || !newName.trim() || newName.trim() === selectedProject.name) return;
    
    try {
      await updateDoc(doc(db, 'projects', selectedProject.id), { name: newName.trim() });
    } catch (e: any) {
      showAlert(`수정 실패: ${e.message}`);
    }
  };

  const handleDeleteProject = async () => {
    if (!selectedProject) return;
    showConfirm(`[${selectedProject.name}] 프로젝트를 삭제하시겠습니까?\n프로젝트에 속한 모든 예약 내역도 함께 삭제되며 복구할 수 없습니다.`, async () => {
      try {
        const q = query(collection(db, 'reservations'), where('projectId', '==', selectedProject.id));
        const snapshot = await getDocs(q);
        
        const chunks = [];
        for (let i = 0; i < snapshot.docs.length; i += 500) {
          chunks.push(snapshot.docs.slice(i, i + 500));
        }
        
        for (const chunk of chunks) {
          const batch = writeBatch(db);
          chunk.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }

        await deleteDoc(doc(db, 'projects', selectedProject.id));
        setSelectedProject(null);
      } catch (e: any) {
        showAlert(`프로젝트 삭제 실패: ${e.message}`);
      }
    });
  };

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['그룹명(필수)', '이름', '중요도', '연락처뒷자리', '매수'],
      ['시사회_VIP', '홍길동', '10', '1234', '2'],
      ['시사회_VIP', '', '10', '', '2'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '업로드양식');
    XLSX.writeFile(wb, '시사회_좌석자동배치_양식.xlsx');
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-blue-500/30 flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-50 shrink-0">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
              <Film className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">시사회 좌석 관리</h1>
              <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">Premiere Seat</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Project Selection */}
            {projects.length > 0 && (
              <div className="flex items-center gap-2 pr-4 border-r border-zinc-800">
                <select
                  value={selectedProject?.id || ''}
                  onChange={e => setSelectedProject(projects.find(p => p.id === e.target.value) || null)}
                  className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {isAdmin && (
                  <div className="flex gap-1">
                    <button onClick={handleUpdateProjectName} className="text-zinc-400 hover:text-white px-2 py-1 text-xs bg-zinc-800 rounded transition-colors" title="이름 변경">
                      ✎
                    </button>
                    <button onClick={handleDeleteProject} className="text-zinc-400 hover:text-red-400 px-2 py-1 text-xs bg-zinc-800 rounded transition-colors" title="프로젝트 삭제">
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <button onClick={() => setShowProjectModal(true)} className="text-zinc-400 hover:text-blue-400 px-2 py-1 text-xs bg-zinc-800 rounded transition-colors" title="새 프로젝트">
                      +
                    </button>
                  </div>
                )}
              </div>
            )}
            
            {isAdmin && projects.length === 0 && (
              <button onClick={() => setShowProjectModal(true)} className="text-blue-400 hover:text-blue-300 px-3 py-1.5 text-sm border border-blue-500/30 rounded-lg mr-4">
                프로젝트 만들기
              </button>
            )}

            {isAdmin && (
              <button 
                onClick={() => setShowAdmin(!showAdmin)}
                className={cn(
                  "p-2 rounded-lg transition-colors flex items-center gap-2",
                  showAdmin ? "bg-blue-600 text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
                )}
              >
                <Settings className="w-5 h-5" />
                <span className="text-sm font-medium mr-1">관리자 패널</span>
              </button>
            )}
            
            {user ? (
              <div className="flex items-center gap-3 pl-4 border-l border-zinc-800">
                <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-zinc-700" />
                <button onClick={handleLogout} className="text-zinc-400 hover:text-white transition-colors">
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                관리자 로그인
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-10">
        {!isAdmin ? (
          /* ==================================================== */
          /* GUEST VIEW: Search Ticket by Phone */
          /* ==================================================== */
          <div className="max-w-2xl mx-auto w-full flex flex-col items-center justify-center min-h-[60vh] space-y-10">
            <div className="text-center space-y-3">
              <h2 className="text-3xl font-bold text-white tracking-tight">나의 시사회 좌석 확인</h2>
              <p className="text-zinc-400">배정된 시사회 좌석을 확인하려면 연락처 뒷자리 4자리를 입력해주세요.</p>
            </div>
            
            <form onSubmit={handleCheckReservation} className="w-full max-w-md space-y-4">
              <div className="relative">
                <input 
                  type="text" 
                  maxLength={4}
                  value={searchPhone}
                  onChange={(e) => setSearchPhone(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="뒷자리 4자리 (예: 1234)"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-4 text-xl text-center text-white font-mono tracking-widest focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all placeholder:text-zinc-600"
                />
              </div>
              <button 
                type="submit"
                disabled={isSearching || searchPhone.length < 4}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-blue-600/20 active:scale-95"
              >
                {isSearching ? '조회 중...' : '조회하기'}
              </button>
            </form>

            <AnimatePresence mode="popLayout">
              {searchResults.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full space-y-4 mt-8"
                >
                  {(() => {
                    // Group results by theaterId
                    const grouped = searchResults.reduce((acc, curr) => {
                      if (!acc[curr.theaterId]) acc[curr.theaterId] = [];
                      acc[curr.theaterId].push(curr);
                      return acc;
                    }, {} as Record<string, Reservation[]>);
                    
                    return Object.entries(grouped).map(([theaterId, resList]) => {
                      const theaterInfo = theaters.find(t => t.id === theaterId);
                      if (!theaterInfo) return null;
                      
                      // sort reservations by seatId for clean display
                      const seatLabels = (resList as Reservation[]).map(r => theaterInfo.seats[r.seatId]?.label || r.seatId).sort();
                      
                      return (
                        <div key={theaterId} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-bold text-zinc-500 mb-1">{theaterInfo.branch}</p>
                            <h3 className="text-xl font-bold text-white tracking-tight">{theaterInfo.name}</h3>
                            <p className="text-zinc-400 mt-2">총 <span className="text-blue-400 font-bold">{(resList as Reservation[]).length}</span>석 배정됨</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-zinc-500 font-mono mb-2 uppercase tracking-widest">Seat Number</p>
                            <p className="text-2xl font-bold font-mono text-zinc-100 flex flex-wrap gap-2 justify-end">
                              {seatLabels.map(lbl => (
                                <span key={lbl} className="bg-zinc-800 px-3 py-1 rounded inline-block border border-zinc-700">{lbl}</span>
                              ))}
                            </p>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          /* ==================================================== */
          /* ADMIN VIEW: Dropdown & Selection Map */
          /* ==================================================== */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
            {/* Left Column: Controls & Info */}
            <div className="lg:col-span-4 space-y-8">
              <section className="space-y-4">
                <div className="flex gap-2 items-center justify-between">
                  <h2 className="text-sm font-mono text-zinc-500 uppercase tracking-widest">상영관 선택</h2>
                </div>
                <div className="relative">
                  <select
                    value={selectedTheater?.id || ''}
                    onChange={(e) => setSelectedTheater(theaters.find(t => t.id === e.target.value) || null)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors cursor-pointer appearance-none shadow-lg"
                  >
                    <option value="">관리할 상영관을 선택하세요</option>
                    {groupedTheaters.map(([branch, ths]) => (
                      <optgroup key={branch} label={branch} className="bg-zinc-900 text-zinc-400">
                        {ths.map(t => (
                          <option key={t.id} value={t.id} className="text-white">
                            {t.name} (총 {Object.keys(t.seats).length}석)
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                    <ChevronRight className="w-5 h-5 text-zinc-500 rotate-90" />
                  </div>
                </div>

                {selectedTheater && isAdmin && (
                  <div className="space-y-2 mt-2">
                    <button 
                      className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 font-bold py-3 text-sm rounded-xl transition-colors"
                      onClick={(e) => handleDeleteTheater(selectedTheater.id, e)}
                    >
                      현재 상영관 및 모든 예약 데이터 삭제
                    </button>
                    
                    <div className="pt-4 border-t border-zinc-800">
                      <p className="text-xs text-zinc-500 mb-2 font-mono uppercase tracking-widest text-center">AI Auto Placement</p>
                      <button
                        onClick={handleDownloadTemplate}
                        className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold py-2.5 text-sm rounded-xl transition-colors mb-2 flex items-center justify-center gap-2"
                      >
                        <Download className="w-4 h-4" /> 엑셀 양식 다운로드
                      </button>
                      <div className="relative overflow-hidden w-full bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 font-bold py-3 text-sm rounded-xl transition-colors text-center cursor-pointer shadow-lg shadow-indigo-500/10">
                        <span>엑셀 업로드로 AI 자동 배치 시작</span>
                        <input 
                          type="file" 
                          accept=".xlsx, .xls, .csv" 
                          onChange={handleExcelUpload}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {selectedTheater && !showAdmin && (
                <section className="p-6 bg-zinc-900 rounded-2xl border border-zinc-800 space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-xl font-bold flex items-center gap-2">
                      <Check className="w-5 h-5 text-blue-500" /> 좌석 예약하기
                    </h3>
                    <p className="text-sm text-zinc-400">오른쪽 배치도에서 원하는 좌석을 여러 개 선택하시고 배정 정보를 입력하세요.</p>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-mono text-zinc-500 uppercase">선택된 좌석 ({selectedSeats.length}개)</label>
                      <div className="min-h-[48px] bg-zinc-950 border border-zinc-800 rounded-lg flex flex-wrap items-center gap-2 p-2 shadow-inner">
                        {selectedSeats.length > 0 ? (
                          selectedSeats.map(seat => (
                            <div key={seat.id} className="bg-blue-600/20 border border-blue-500/30 text-blue-400 text-xs font-mono px-2 py-1 rounded flex items-center gap-1.5 shadow-sm">
                              {seat.label}
                              <button 
                                onClick={() => handleSeatClick(seat)}
                                className="hover:bg-blue-500/20 rounded-full p-0.5 transition-colors"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))
                        ) : (
                          <span className="text-zinc-600 italic text-sm pl-2">지도에서 빈 좌석을 클릭하세요</span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <label className="text-xs font-mono text-zinc-500 uppercase">소속/그룹명 (선택)</label>
                        <div className="relative">
                          <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                          <input 
                            type="text" 
                            value={groupName}
                            onChange={(e) => setGroupName(e.target.value)}
                            placeholder="소속명"
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-mono text-zinc-500 uppercase">성함 *</label>
                        <div className="relative">
                          <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                          <input 
                            type="text" 
                            value={userName}
                            onChange={(e) => setUserName(e.target.value)}
                            placeholder="홍길동"
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-mono text-zinc-500 uppercase">연락처 뒷자리 (4자리)</label>
                      <input 
                        type="text" 
                        maxLength={4}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="예: 5678 (고객 조회용)"
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors font-mono tracking-widest"
                      />
                    </div>

                    <button 
                      onClick={handleReserve}
                      disabled={selectedSeats.length === 0 || !userName || isReserving}
                      className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-blue-600/20 active:scale-95 mt-4"
                    >
                      {isReserving ? '처리 중...' : `${selectedSeats.length}개 좌석 예약 완료`}
                    </button>
                  </div>
                </section>
              )}

              <div className="p-4 bg-zinc-900/30 rounded-xl border border-zinc-800/50 flex gap-3">
                <Info className="w-5 h-5 text-zinc-500 shrink-0" />
                <p className="text-xs text-zinc-500 leading-relaxed">
                  [관리자 가이드]<br/>
                  • 빈 좌석을 클릭해 예약을 배정할 수 있습니다.<br/>
                  • 선택한 좌석들(파란색)을 드래그 앤 드롭으로 <span className="text-blue-400 font-bold">배치 변경(이동)</span> 시킬 수 있습니다.<br/>
                  • 이미 배정 완료된 좌석(빨간색)을 클릭하면 취소 또는 수정 팝업이 나타납니다.
                </p>
              </div>
            </div>

            {/* Right Column: Seat Map or Admin */}
            <div className="lg:col-span-8">
              <AnimatePresence mode="wait">
                {showAdmin ? (
                  <motion.div
                    key="admin"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                  >
                    <AdminPanel />
                  </motion.div>
                ) : selectedTheater ? (
                  <motion.div
                    key="map"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="space-y-6"
                  >
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                      <div>
                        <h2 className="text-2xl font-bold">{selectedTheater.name}</h2>
                        <p className="text-zinc-500">{selectedTheater.branch}</p>
                      </div>
                      <div className="flex gap-6 items-end">
                        <button 
                          onClick={handleExportCSV}
                          className="flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 hover:border-zinc-600 text-sm text-zinc-300 py-2 px-4 rounded-lg transition-colors h-[42px]"
                        >
                          <Download className="w-4 h-4" /> 엑셀(CSV) 다운로드
                        </button>
                        <div className="text-right">
                          <p className="text-3xl font-mono font-bold text-blue-500 leading-none">
                            {Object.keys(reservations).length} <span className="text-zinc-600 text-2xl">/ {Object.keys(selectedTheater.seats).length}</span>
                          </p>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">Reserved Seats</p>
                        </div>
                      </div>
                    </div>
                    
                    <SeatMap 
                      theater={selectedTheater} 
                      reservations={reservations}
                      selectedSeats={selectedSeats}
                      onSeatClick={handleSeatClick}
                      isAdmin={isAdmin}
                      onSeatDrop={handleSelectionDrop}
                    />
                  </motion.div>
                ) : (
                  <div className="h-[600px] flex flex-col items-center justify-center text-zinc-600 space-y-4 border border-dashed border-zinc-800 rounded-3xl">
                    <Film className="w-16 h-16 opacity-20" />
                    <p>좌측에서 상영관을 선택하면 좌석 배치도가 나타납니다.</p>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-8 border-t border-zinc-900 py-10 px-6 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <p className="text-zinc-600 text-sm">© 2026 Premiere Seat Manager. All rights reserved.</p>
          <div className="flex gap-6 text-zinc-600 text-sm">
            <a href="#" className="hover:text-zinc-400 transition-colors">이용약관</a>
            <a href="#" className="hover:text-zinc-400 transition-colors">개인정보처리방침</a>
          </div>
        </div>
      </footer>

      {/* Global Dialog Modal */}
      <AnimatePresence>
        {dialog?.isOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl"
            >
              <h3 className="text-lg font-bold mb-4 whitespace-pre-wrap leading-relaxed">{dialog.message}</h3>
              
              <div className="flex justify-end gap-3 mt-6">
                {dialog.type === 'confirm' && (
                  <button 
                    onClick={() => {
                      dialog.onCancel?.();
                      setDialog(null);
                    }}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                  >
                    취소
                  </button>
                )}
                <button 
                  onClick={() => {
                    dialog.onConfirm?.();
                    setDialog(null);
                  }}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-bold transition-colors",
                    dialog.type === 'confirm' ? "bg-red-600 hover:bg-red-500 text-white" : "bg-blue-600 hover:bg-blue-500 text-white"
                  )}
                >
                  확인
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Editing Reservation Modal */}
      <AnimatePresence>
        {editingReservation && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-6"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xl font-bold flex items-center gap-2">예약 관리 <span className="text-blue-500 text-sm bg-blue-500/10 px-2 py-0.5 rounded font-mono">{editingReservation.seatId}</span></h3>
                  <button onClick={() => setEditingReservation(null)} className="text-zinc-500 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <p className="text-xs text-zinc-400">배정된 인원의 정보를 수정하거나 취소합니다.</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-mono text-zinc-500 uppercase">성함 *</label>
                  <input type="text" value={editForm.userName} onChange={e => setEditForm({...editForm, userName: e.target.value})} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-mono text-zinc-500 uppercase">소속/그룹명</label>
                  <input type="text" value={editForm.groupName} onChange={e => setEditForm({...editForm, groupName: e.target.value})} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-mono text-zinc-500 uppercase">연락처 뒷자리 (4자리)</label>
                  <input type="text" maxLength={4} value={editForm.phoneLast4} onChange={e => setEditForm({...editForm, phoneLast4: e.target.value.replace(/[^0-9]/g, '')})} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors font-mono tracking-widest" />
                </div>
              </div>
              
              <div className="pt-2 flex flex-col gap-2">
                <button onClick={handleUpdateReservation} disabled={!editForm.userName} className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-600/20 active:scale-95">정보 수정하기</button>
                <div className="grid grid-cols-2 gap-2 mt-4 border-t border-zinc-800 pt-4">
                  <button onClick={handleCancelSingle} className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 font-bold py-3 text-sm rounded-xl transition-colors">이 좌석만 단건 취소</button>
                  {editingReservation.groupName && (
                    <button onClick={handleCancelGroup} className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 text-sm rounded-xl transition-colors shadow-lg active:scale-95">그룹 전체 취소</button>
                  )}
                </div>
                
                <div className="border-t border-zinc-800 pt-4 mt-2 space-y-2">
                  <label className="text-xs font-mono text-zinc-500 uppercase">티켓을 다른 상영관으로 배정하기</label>
                  <div className="flex gap-2">
                    <select
                      value={moveTargetTheaterId}
                      onChange={e => setMoveTargetTheaterId(e.target.value)}
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
                    >
                      <option value="">이동할 상영관 선택...</option>
                      {theaters.filter(t => t.id !== selectedTheater?.id).map(t => (
                        <option key={t.id} value={t.id}>{t.name} ({t.branch})</option>
                      ))}
                    </select>
                    <button 
                      onClick={handleMoveToAnotherTheater}
                      disabled={!moveTargetTheaterId}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-bold text-sm rounded-lg transition-colors whitespace-nowrap"
                    >
                      이동
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Project Creation Modal */}
      <AnimatePresence>
        {showProjectModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl"
            >
              <h3 className="text-xl font-bold mb-2">새 프로젝트 만들기</h3>
              <p className="text-zinc-400 text-sm mb-4">영화 제목 등 프로젝트 명을 입력하세요.</p>
              
              <input 
                type="text" 
                value={newProjectName}
                onChange={e => setNewProjectName(e.target.value)}
                placeholder="예: 시사회_어벤져스"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500 mb-6"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateProject();
                }}
              />
              
              <div className="flex justify-end gap-3">
                <button 
                  onClick={() => setShowProjectModal(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                >
                  취소
                </button>
                <button 
                  onClick={handleCreateProject}
                  disabled={!newProjectName.trim()}
                  className="px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white transition-colors"
                >
                  만들기
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}