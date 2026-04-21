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
  CheckCircle2,
  X,
  ChevronRight,
  Info,
  Trash2,
  Download,
  Users,
  FileSpreadsheet,
  TicketCheck,
  LayoutDashboard,
  Map,
  Clock,
  Activity,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import * as XLSX from 'xlsx';

// 예약 타입 확장 (수령 여부 및 수령 시간 정보 포함)
export interface ExtendedReservation extends Reservation {
  isCheckedIn?: boolean;
  checkInTime?: Timestamp;
  theaterName?: string;
  projectName?: string;
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  
  // 관리자 화면 뷰 모드 (배치도 vs 대시보드)
  const [adminViewMode, setAdminViewMode] = useState<'map' | 'dashboard'>('map');

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  const [theaters, setTheaters] = useState<Theater[]>([]);
  const [selectedTheater, setSelectedTheater] = useState<Theater | null>(null);
  const [projectReservations, setProjectReservations] = useState<ExtendedReservation[]>([]);
  
  // 예약 데이터(Record 맵 형태) 계산 - 선택된 상영관용
  const reservations = useMemo<Record<string, ExtendedReservation>>(() => {
    const map: Record<string, ExtendedReservation> = {};
    if (!selectedTheater) return map;
    projectReservations.forEach(r => {
      if (r.theaterId === selectedTheater.id) {
        map[r.seatId] = r;
      }
    });
    return map;
  }, [projectReservations, selectedTheater]);
  
  const [userName, setUserName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [phone, setPhone] = useState('');
  const [searchPhone, setSearchPhone] = useState('');
  const [searchResults, setSearchResults] = useState<ExtendedReservation[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedSeats, setSelectedSeats] = useState<Seat[]>([]);
  const [isReserving, setIsReserving] = useState(false);
  const [editingReservation, setEditingReservation] = useState<ExtendedReservation | null>(null);
  const [editForm, setEditForm] = useState({ userName: '', groupName: '', phoneLast4: '' });
  const [moveTargetTheaterId, setMoveTargetTheaterId] = useState('');

  // 엑셀 자동 배정 모달 전용 상태 (다중 상영관 선택)
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [excelTheaterIds, setExcelTheaterIds] = useState<string[]>([]);
  const [excelFile, setExcelFile] = useState<File | null>(null);

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

  // Auth & Project Load
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAdmin(!!u);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setProjects([]);
      setSelectedProject(null);
      return;
    }
    const q = query(collection(db, 'projects'), where('ownerId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Project));
      docs.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      setProjects(docs);
      
      if (docs.length > 0) {
        setSelectedProject(prev => docs.find(p => p.id === prev?.id) || docs[0]);
      } else {
        setSelectedProject(null);
      }
    });
    return () => unsubscribe();
  }, [user]);

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

  // 프로젝트 단위의 예약 현황 모두 로드
  useEffect(() => {
    if (!selectedProject) {
      setProjectReservations([]);
      return;
    }
    
    setSelectedSeats([]);
    const q = query(collection(db, 'reservations'), where('projectId', '==', selectedProject.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const arr = snapshot.docs.map(d => {
        const data = d.data() as Reservation;
        const theater = theaters.find(t => t.id === data.theaterId);
        return { 
          id: d.id, 
          ...data,
          theaterName: theater ? theater.name : '알 수 없는 상영관'
        } as ExtendedReservation;
      });
      setProjectReservations(arr);
    });
    return () => unsubscribe();
  }, [selectedProject, theaters]);

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

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try { await signInWithPopup(auth, provider); } catch (err) { console.error(err); }
  };

  const handleLogout = () => signOut(auth);

  // 🔥 게스트 현장 티켓 수령(체크인) 처리
  const handleGuestCheckIn = async (theaterId: string, resList: ExtendedReservation[]) => {
    const uncheckedList = resList.filter(r => !r.isCheckedIn);
    if (uncheckedList.length === 0) return;

    showConfirm('현장에서 티켓을 수령하셨습니까?\n[확인]을 누르시면 수령 완료 처리됩니다.', async () => {
      try {
        const batch = writeBatch(db);
        uncheckedList.forEach(r => {
          const ref = doc(db, 'reservations', r.id);
          batch.update(ref, {
            isCheckedIn: true,
            checkInTime: Timestamp.now()
          });
        });
        await batch.commit();
        showAlert('티켓 수령 확인이 완료되었습니다. 즐거운 관람 되세요!');
        
        // 새로고침
        const q = query(collection(db, 'reservations'), where('phoneLast4', '==', searchPhone));
        const snap = await getDocs(q);
        setSearchResults(snap.docs.map(d => ({ id: d.id, ...d.data() } as ExtendedReservation)));
      } catch(e: any) {
        showAlert(`오류가 발생했습니다: ${e.message}`);
      }
    });
  };

  const handleReserve = async () => {
    if (!selectedProject) {
      showAlert("상단 우측에서 예약을 저장할 '새 프로젝트'를 먼저 선택해주세요."); return;
    }
    if (!selectedTheater || selectedSeats.length === 0 || !userName) return;
    
    setIsReserving(true);
    try {
      const batch = writeBatch(db);
      selectedSeats.forEach(seat => {
        const reservationId = `${selectedProject.id}_${selectedTheater.id}_${seat.id}`;
        batch.set(doc(db, 'reservations', reservationId), {
          projectId: selectedProject.id,
          theaterId: selectedTheater.id,
          seatId: seat.id,
          userName: userName,
          groupName: groupName,
          phoneLast4: phone.slice(-4),
          reservedAt: Timestamp.now(),
          isCheckedIn: false
        });
      });
      await batch.commit();
      setSelectedSeats([]); setUserName(''); setPhone('');
    } catch (err: any) {
      showAlert(`예약 중 오류가 발생했습니다: ${err.message}`);
    } finally {
      setIsReserving(false);
    }
  };

  const handleClearProjectReservations = async () => {
    if (!isAdmin || !selectedProject) return;
    
    showConfirm(`[${selectedProject.name}] 프로젝트의 모든 상영관 예약 데이터를 전체 초기화하시겠습니까?\n(좌석 구조 등은 유지되며, 현재까지의 모든 예약 명단만 완전히 삭제됩니다.)`, async () => {
      try {
        const q = query(collection(db, 'reservations'), where('projectId', '==', selectedProject.id));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
          showAlert('삭제할 예약 내역이 없습니다.'); return;
        }
        
        const chunks = [];
        for (let i = 0; i < snapshot.docs.length; i += 500) chunks.push(snapshot.docs.slice(i, i + 500));
        
        for (const chunk of chunks) {
          const batch = writeBatch(db);
          chunk.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
        showAlert(`[${selectedProject.name}] 프로젝트의 모든 상영관 예약 내역이 성공적으로 초기화되었습니다.`);
      } catch (err: any) {
        showAlert(`전체 예약 초기화 중 오류가 발생했습니다: ${err.message}`);
      }
    });
  };

  const handleClearReservations = async (theaterId: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!isAdmin) return;
    
    showConfirm('현재 상영관의 모든 예약 데이터를 초기화하시겠습니까?\n(상영관 좌석 구조는 유지되며 예약 내역만 삭제됩니다.)', async () => {
      try {
        const q = query(collection(db, 'reservations'), where('theaterId', '==', theaterId));
        const snapshot = await getDocs(q);
        const chunks = [];
        for (let i = 0; i < snapshot.docs.length; i += 500) chunks.push(snapshot.docs.slice(i, i + 500));
        
        for (const chunk of chunks) {
          const batch = writeBatch(db);
          chunk.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
        showAlert('현재 상영관의 모든 예약 내역이 성공적으로 초기화되었습니다.');
      } catch (err: any) {
        showAlert(`예약 초기화 중 오류가 발생했습니다: ${err.message}`);
      }
    });
  };

  const handleMoveToAnotherTheater = async () => {
    if (!editingReservation || !selectedTheater || !moveTargetTheaterId || !selectedProject) return;
    const targetTheater = theaters.find(t => t.id === moveTargetTheaterId);
    if (!targetTheater) return;

    try {
      let reservationsToMove: ExtendedReservation[] = [];
      if (editingReservation.groupName) {
        reservationsToMove = (Object.values(reservations) as ExtendedReservation[]).filter(r => r.groupName === editingReservation.groupName);
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
        showAlert(`빈 좌석이 부족합니다. (필요: ${reservationsToMove.length}석, 남은 좌석: ${availableSeats.length}석)`); return;
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
                  if (j > 0 && block[j].seat.col - block[j - 1].seat.col !== 1) { contiguous = false; break; }
              }
              if (contiguous && blockScore < bestScore) {
                  bestScore = blockScore;
                  bestBlock = block.map(b => b.seat);
              }
          }
      }

      if (bestBlock.length === 0) bestBlock = scoredSeats.sort((a, b) => a.score - b.score).slice(0, count).map(b => b.seat);

      const batch = writeBatch(db);
      for (let i = 0; i < count; i++) {
        const oldRes = reservationsToMove[i];
        const newSeat = bestBlock[i];
        batch.delete(doc(db, 'reservations', oldRes.id || `${selectedProject.id}_${selectedTheater.id}_${oldRes.seatId}`));
        batch.set(doc(db, 'reservations', `${selectedProject.id}_${targetTheater.id}_${newSeat.id}`), {
          projectId: selectedProject.id, theaterId: targetTheater.id, seatId: newSeat.id,
          userName: oldRes.userName, groupName: oldRes.groupName || '',
          phoneLast4: oldRes.phoneLast4 || '', reservedAt: oldRes.reservedAt, isCheckedIn: oldRes.isCheckedIn || false
        });
      }
      await batch.commit();
      showAlert(`자동 배정하여 총 ${count}석을 이동시켰습니다.`);
      setEditingReservation(null); setMoveTargetTheaterId('');
    } catch(e: any) { showAlert(`이동 중 오류 발생: ${e.message}`); }
  };

  const handleSelectionDrop = (sourceSeatId: string, targetSeatId: string) => {
    if (!selectedTheater || selectedSeats.length === 0) return;
    const sourceSeat = selectedTheater.seats[sourceSeatId];
    const targetSeat = selectedTheater.seats[targetSeatId];
    if (!sourceSeat || !targetSeat) return;

    const rowLabels = Array.from(new Set(Object.values(selectedTheater.seats).map(s => (s as Seat).row))).sort();
    const rowOffset = rowLabels.indexOf(targetSeat.row) - rowLabels.indexOf(sourceSeat.row);
    const colOffset = targetSeat.col - sourceSeat.col;

    const newSelected: Seat[] = [];
    for (const s of selectedSeats) {
      const newRowIdx = rowLabels.indexOf(s.row) + rowOffset;
      if (newRowIdx < 0 || newRowIdx >= rowLabels.length) { showAlert('해당 위치로는 옮길 수 없습니다.'); return; }
      const newSeatId = `${rowLabels[newRowIdx]}-${s.col + colOffset}`;
      const newSeat = selectedTheater.seats[newSeatId];

      if (!newSeat || newSeat.type === 'empty' || reservations[newSeatId]) {
        showAlert('이동하려는 범위에 유효하지 않거나 예약된 좌석이 포함되어 있습니다.'); return;
      }
      newSelected.push(newSeat);
    }
    setSelectedSeats(newSelected);
  };

  const handleUpdateReservation = async () => {
    if (!editingReservation || !selectedTheater || !selectedProject) return;
    try {
      await updateDoc(doc(db, 'reservations', `${selectedProject.id}_${selectedTheater.id}_${editingReservation.seatId}`), {
        userName: editForm.userName, groupName: editForm.groupName, phoneLast4: editForm.phoneLast4
      });
      setEditingReservation(null);
    } catch(e: any) { showAlert(`수정 중 오류가 발생했습니다: ${e.message}`); }
  };

  const handleCancelSingle = () => {
    if (!editingReservation || !selectedProject) return;
    showConfirm(`[${editingReservation.seatId}] 예약을 취소하시겠습니까?`, async () => {
      try {
        await deleteDoc(doc(db, 'reservations', `${selectedProject.id}_${selectedTheater?.id}_${editingReservation.seatId}`));
        setEditingReservation(null);
      } catch(e: any) { showAlert(`취소에 실패했습니다: ${e.message}`); }
    });
  };

  const handleCancelGroup = () => {
    if (!editingReservation?.groupName || !selectedProject) return;
    showConfirm(`그룹 [${editingReservation.groupName}] 전체 예약을 취소하시겠습니까?`, async () => {
      try {
        const batch = writeBatch(db);
        (Object.values(reservations) as ExtendedReservation[]).forEach((res) => {
          if (res.groupName === editingReservation.groupName) {
            batch.delete(doc(db, 'reservations', `${selectedProject.id}_${selectedTheater?.id}_${res.seatId}`));
          }
        });
        await batch.commit();
        setEditingReservation(null);
      } catch(e: any) { showAlert(`그룹 취소에 실패했습니다: ${e.message}`); }
    });
  };

  const handleExportCSV = () => {
    if (!selectedTheater) return;
    const csvRows = [];
    const colIndices = Array.from({ length: selectedTheater.cols }, (_, i) => i + 1);
    
    csvRows.push(['열\\번호', ...colIndices.map(String)]);
    const rowLabels = Array.from(new Set(Object.values(selectedTheater.seats).map(s => (s as Seat).row))).sort();
    
    rowLabels.forEach(row => {
      const rowData = [row];
      colIndices.forEach(col => {
        const seatId = `${row}-${col}`;
        const seat = selectedTheater.seats[seatId];
        const res = reservations[seatId];
        
        if (!seat || seat.type === 'empty') rowData.push('');
        else if (res) {
          const text = `${res.groupName ? `[${res.groupName}] ` : ''}${res.userName}`;
          rowData.push(`"${text.replace(/"/g, '""')}"`);
        } 
        else rowData.push('빈좌석');
      });
      csvRows.push(rowData);
    });
    
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI("data:text/csv;charset=utf-8,\uFEFF" + csvRows.map(e => e.join(',')).join("\n")));
    link.setAttribute("download", `좌석배치표_${selectedTheater.name}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
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
    setSelectedSeats(prev => prev.find(s => s.id === seat.id) ? prev.filter(s => s.id !== seat.id) : [...prev, seat]);
  };

  const runExcelPlacement = async () => {
    if (!selectedProject || excelTheaterIds.length === 0 || !excelFile) {
      showAlert("프로젝트, 배정할 대관 현황(상영관), 엑셀 파일을 모두 확인해주세요."); return;
    }
    const targetTheaters = theaters.filter(t => excelTheaterIds.includes(t.id));
    if (targetTheaters.length === 0) return;

    setIsReserving(true);
    try {
      const wb = XLSX.read(await excelFile.arrayBuffer(), { type: 'array' });
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];
      const rows = data.slice(1).filter(r => r[0] || r[1]); 
      
      if (rows.length === 0) { showAlert("유효한 엑셀 데이터가 없습니다."); return; }

      // Get all available seats across all selected theaters
      let allAvailableSeats: { theaterId: string; seat: Seat; score: number }[] = [];
      const usedSeatIdsPerTheater: Record<string, Set<string>> = {};
      
      for (const targetTheater of targetTheaters) {
        usedSeatIdsPerTheater[targetTheater.id] = new Set<string>();
        const targetReservationsSnap = await getDocs(query(collection(db, 'reservations'), where('projectId', '==', selectedProject.id), where('theaterId', '==', targetTheater.id)));
        const existingResIds = new Set(targetReservationsSnap.docs.map(d => (d.data() as Reservation).seatId));
        const availableSeats = (Object.values(targetTheater.seats) as Seat[]).filter(s => s.type !== 'empty' && !existingResIds.has(s.id));
        
        const rowLabels = Array.from(new Set((Object.values(targetTheater.seats) as Seat[]).map(s => s.row))).sort();
        const centerRowIdx = Math.floor(rowLabels.length / 2);
        const centerCol = Math.floor(targetTheater.cols / 2);
        
        availableSeats.forEach(s => {
          const rowIdx = rowLabels.indexOf(s.row);
          const rowDist = Math.abs(rowIdx - centerRowIdx) * 2; 
          const colDist = Math.abs(s.col - centerCol);
          allAvailableSeats.push({
            theaterId: targetTheater.id,
            seat: s,
            score: (Math.max(rowDist, colDist) * 100) + (rowDist * 2) + colDist
          });
        });
      }

      interface Request { groupName: string; name: string; priority: number; phone: string; count: number; }
      const requests: Request[] = rows.map(r => ({
        groupName: String(r[0] || '').trim(), name: String(r[1] || '').trim(),
        priority: parseInt(r[2]) || 1, phone: String(r[3] || '').replace(/[^0-9]/g, '').slice(-4),
        count: parseInt(r[4]) || 1
      }));
      
      const groupsObj: Record<string, { priority: number; members: Request[]; totalCount: number; name: string; }> = {};
      requests.forEach(req => {
        const gName = req.groupName || req.name || '미지정그룹';
        if (!groupsObj[gName]) groupsObj[gName] = { priority: req.priority, members: [], totalCount: 0, name: gName };
        groupsObj[gName].priority = Math.max(groupsObj[gName].priority, req.priority); 
        groupsObj[gName].members.push(req);
        groupsObj[gName].totalCount += req.count;
      });

      const sortedGroups = Object.values(groupsObj).sort((a, b) => b.priority - a.priority || b.totalCount - a.totalCount);

      const batches = [writeBatch(db)];
      let [currentBatchIndex, opCount, placedCount, failCount] = [0, 0, 0, 0];

      // Groups seats by theater & row
      const seatsByTheaterAndRow: Record<string, Record<string, typeof allAvailableSeats>> = {};
      allAvailableSeats.forEach(ss => {
        if (!seatsByTheaterAndRow[ss.theaterId]) seatsByTheaterAndRow[ss.theaterId] = {};
        if (!seatsByTheaterAndRow[ss.theaterId][ss.seat.row]) seatsByTheaterAndRow[ss.theaterId][ss.seat.row] = [];
        seatsByTheaterAndRow[ss.theaterId][ss.seat.row].push(ss);
      });
      // Sort seats by col
      Object.keys(seatsByTheaterAndRow).forEach(tId => {
        Object.keys(seatsByTheaterAndRow[tId]).forEach(row => {
          seatsByTheaterAndRow[tId][row].sort((a, b) => a.seat.col - b.seat.col);
        });
      });

      const placeGroup = (count: number) => {
          let bestBlock: typeof allAvailableSeats = [];
          let bestScore = Infinity;
          
          for (const tId of Object.keys(seatsByTheaterAndRow)) {
            for (const rList of Object.values(seatsByTheaterAndRow[tId])) {
                for (let i = 0; i <= rList.length - count; i++) {
                    const block = rList.slice(i, i + count);
                    let contiguous = true; let blockScore = 0;
                    for (let j = 0; j < block.length; j++) {
                        if (usedSeatIdsPerTheater[block[j].theaterId].has(block[j].seat.id)) { contiguous = false; break; }
                        blockScore += block[j].score;
                        if (j > 0 && block[j].seat.col - block[j - 1].seat.col !== 1) { contiguous = false; break; }
                    }
                    if (contiguous && blockScore < bestScore) { bestScore = blockScore; bestBlock = block; }
                }
            }
          }
          
          if (bestBlock.length === 0) {
            // Find across all without caring about contiguous but prefer within same theater if possible
            bestBlock = allAvailableSeats
              .filter(ss => !usedSeatIdsPerTheater[ss.theaterId].has(ss.seat.id))
              .sort((a, b) => a.score - b.score)
              .slice(0, count);
          }
          return bestBlock;
      };

      sortedGroups.forEach(group => {
          const seats = placeGroup(group.totalCount);
          if (seats.length < group.totalCount) { failCount += group.totalCount; return; }
          let seatIdx = 0;
          group.members.forEach(req => {
              for(let c=0; c<req.count; c++) {
                  const assignedSeat = seats[seatIdx];
                  usedSeatIdsPerTheater[assignedSeat.theaterId].add(assignedSeat.seat.id);
                  if (opCount >= 490) { batches.push(writeBatch(db)); currentBatchIndex++; opCount = 0; }
                  
                  batches[currentBatchIndex].set(doc(db, 'reservations', `${selectedProject.id}_${assignedSeat.theaterId}_${assignedSeat.seat.id}`), {
                      projectId: selectedProject.id, theaterId: assignedSeat.theaterId, seatId: assignedSeat.seat.id,
                      userName: req.name || `${group.name}의 멤버 ${c+1}`, groupName: req.groupName || group.name,
                      phoneLast4: req.phone, reservedAt: Timestamp.now(), isCheckedIn: false
                  });
                  opCount++; seatIdx++; placedCount++;
              }
          });
      });

      for (const b of batches) await b.commit();
      showAlert(`배치 완료! 총 ${placedCount}명을 배치했습니다.` + (failCount > 0 ? `\n좌석 부족으로 ${failCount}명이 배치되지 못했습니다.` : ''));
      
      setShowExcelModal(false); setExcelFile(null); setExcelTheaterIds([]);
      // Ensure we switch to a relevant theater if any was assigned
      if (excelTheaterIds.length > 0) {
        const displayTheater = theaters.find(t => t.id === excelTheaterIds[0]);
        if (displayTheater) setSelectedTheater(displayTheater);
      }
    } catch(err: any) { showAlert(`오류가 발생했습니다: ${err.message}`); } 
    finally { setIsReserving(false); }
  };

  const handleCheckReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (searchPhone.length < 4) { showAlert("휴대폰 번호 뒷자리 4자리를 정확히 입력해주세요."); return; }
    setIsSearching(true);
    try {
      const q = query(collection(db, 'reservations'), where('phoneLast4', '==', searchPhone));
      const snap = await getDocs(q);
      const results: ExtendedReservation[] = [];
      const projectNames: Record<string, string> = {};
      
      for (const d of snap.docs) {
        const data = d.data() as Reservation;
        let pName = projectNames[data.projectId || ''];
        if (data.projectId && !pName) {
           const pSnap = await getDocs(query(collection(db, 'projects')));
           const pDoc = pSnap.docs.find(px => px.id === data.projectId);
           if (pDoc) {
             pName = pDoc.data().name;
             projectNames[data.projectId] = pName;
           } else {
             pName = '알 수 없는 프로젝트';
             projectNames[data.projectId] = pName;
           }
        }
        results.push({ id: d.id, ...data, projectName: pName } as ExtendedReservation);
      }
      
      if(results.length === 0) showAlert("입력하신 번호로 배정된 좌석이 없습니다.");
      setSearchResults(results);
    } catch(err: any) { showAlert(`조회 오류: ${err.message}`); } 
    finally { setIsSearching(false); }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !user) return;
    try {
      const ref = doc(collection(db, 'projects'));
      const batch = writeBatch(db);
      batch.set(ref, { name: newProjectName.trim(), createdAt: Timestamp.now(), ownerId: user.uid });
      await batch.commit();
      setNewProjectName(''); setShowProjectModal(false);
    } catch(e: any) { showAlert(`프로젝트 생성 실패: ${e.message}`); }
  };

  const handleUpdateProjectName = async () => {
    if (!selectedProject) return;
    const newName = prompt('새 프로젝트 이름을 입력하세요', selectedProject.name);
    if (!newName || !newName.trim() || newName.trim() === selectedProject.name) return;
    try { await updateDoc(doc(db, 'projects', selectedProject.id), { name: newName.trim() }); } 
    catch (e: any) { showAlert(`수정 실패: ${e.message}`); }
  };

  const handleDeleteProject = async () => {
    if (!selectedProject) return;
    showConfirm(`[${selectedProject.name}] 프로젝트를 영구 삭제하시겠습니까?`, async () => {
      try {
        const q = query(collection(db, 'reservations'), where('projectId', '==', selectedProject.id));
        const snapshot = await getDocs(q);
        const chunks = [];
        for (let i = 0; i < snapshot.docs.length; i += 500) chunks.push(snapshot.docs.slice(i, i + 500));
        for (const chunk of chunks) {
          const batch = writeBatch(db);
          chunk.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
        await deleteDoc(doc(db, 'projects', selectedProject.id));
        setSelectedProject(null);
      } catch (e: any) { showAlert(`삭제 실패: ${e.message}`); }
    });
  };

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([['그룹명(필수)', '이름', '중요도', '연락처뒷자리', '매수'], ['시사회_VIP', '홍길동', '10', '1234', '2']]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '업로드양식');
    XLSX.writeFile(wb, '시사회_좌석자동배치_양식.xlsx');
  };

  // 🔥 대시보드 통계 데이터 계산 (프로젝트 전관 통합 스탯)
  const dashboardStats = useMemo(() => {
    if (!selectedProject) return null;
    const resList = projectReservations;
    const totalAssigned = resList.length;
    const checkedIn = resList.filter(r => r.isCheckedIn).length;
    const pending = totalAssigned - checkedIn;
    const checkInRate = totalAssigned > 0 ? Math.round((checkedIn / totalAssigned) * 100) : 0;
    const recentLogs = resList.filter(r => r.isCheckedIn && r.checkInTime).sort((a, b) => b.checkInTime!.toMillis() - a.checkInTime!.toMillis());
    const pendingLogs = resList.filter(r => !r.isCheckedIn).sort((a, b) => a.userName.localeCompare(b.userName));
    return { totalAssigned, checkedIn, pending, checkInRate, recentLogs, pendingLogs };
  }, [projectReservations, selectedProject]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans selection:bg-blue-500/30 flex flex-col">
      <header className="border-b border-gray-200 bg-white/50 backdrop-blur-md sticky top-0 z-50 shrink-0">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
              <Film className="w-6 h-6 text-gray-900" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">시사회 좌석 확인</h1>
              <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">Premiere Seat</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {isAdmin && projects.length > 0 && (
              <div className="flex items-center gap-2 pr-4 border-r border-gray-200">
                <select
                  value={selectedProject?.id || ''}
                  onChange={e => setSelectedProject(projects.find(p => p.id === e.target.value) || null)}
                  className="bg-gray-100 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
                >
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <div className="flex gap-1">
                  <button onClick={handleUpdateProjectName} className="text-gray-600 hover:text-gray-900 px-2 py-1 text-xs bg-gray-100 rounded transition-colors" title="이름 변경">✎</button>
                  <button onClick={handleDeleteProject} className="text-gray-600 hover:text-red-400 px-2 py-1 text-xs bg-gray-100 rounded transition-colors" title="프로젝트 삭제"><Trash2 className="w-3 h-3" /></button>
                  <button onClick={() => setShowProjectModal(true)} className="text-gray-600 hover:text-blue-400 px-2 py-1 text-xs bg-gray-100 rounded transition-colors" title="새 프로젝트">+</button>
                </div>
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
                className={cn("p-2 rounded-lg transition-colors flex items-center gap-2", showAdmin ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900")}
              >
                <Settings className="w-5 h-5" />
                <span className="text-sm font-medium mr-1">관리자 패널</span>
              </button>
            )}
            
            {user ? (
              <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
                <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-gray-300" />
                <button onClick={handleLogout} className="text-gray-600 hover:text-gray-900 transition-colors"><LogOut className="w-5 h-5" /></button>
              </div>
            ) : (
              <button onClick={handleLogin} className="bg-gray-100 hover:bg-gray-200 text-gray-900 px-4 py-2 rounded-lg text-sm font-medium transition-colors">관리자 로그인</button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-10">
        {!isAdmin ? (
          <div className="max-w-2xl mx-auto w-full flex flex-col items-center justify-center min-h-[60vh] space-y-10">
            <div className="text-center space-y-3">
              <h2 className="text-3xl font-bold text-gray-900 tracking-tight">나의 시사회 좌석 확인</h2>
              <p className="text-gray-600">배정된 시사회 좌석을 확인하려면 연락처 뒷자리 4자리를 입력해주세요.</p>
            </div>
            
            <form onSubmit={handleCheckReservation} className="w-full max-w-md space-y-4">
              <div className="relative">
                <input 
                  type="text" maxLength={4} value={searchPhone} onChange={(e) => setSearchPhone(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="뒷자리 4자리 (예: 1234)"
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-4 text-xl text-center text-gray-900 font-mono tracking-widest focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all placeholder:text-gray-400"
                />
              </div>
              <button type="submit" disabled={isSearching || searchPhone.length < 4} className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-100 disabled:text-gray-400 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-blue-600/20 active:scale-95">
                {isSearching ? '조회 중...' : '조회하기'}
              </button>
            </form>

            <AnimatePresence mode="popLayout">
              {searchResults.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full space-y-4 mt-8">
                  {(() => {
                    const grouped = searchResults.reduce((acc, curr) => {
                      if (!acc[curr.theaterId]) acc[curr.theaterId] = [];
                      acc[curr.theaterId].push(curr);
                      return acc;
                    }, {} as Record<string, ExtendedReservation[]>);
                    
                    return (Object.entries(grouped) as [string, ExtendedReservation[]][]).map(([theaterId, resList]) => {
                      const theaterInfo = theaters.find(t => t.id === theaterId);
                      if (!theaterInfo) return null;
                      
                      const seatLabels = resList.map(r => theaterInfo.seats[r.seatId]?.label || r.seatId).sort();
                      const isAllCheckedIn = resList.every(r => r.isCheckedIn);
                      
                      return (
                        <div key={theaterId} className="bg-white border border-gray-200 rounded-2xl p-6 overflow-hidden relative">
                          {isAllCheckedIn && (
                            <div className="absolute -right-4 -bottom-4 opacity-10 rotate-[-15deg] pointer-events-none">
                              <TicketCheck className="w-48 h-48 text-green-500" />
                            </div>
                          )}
                          <div className="flex items-start justify-between mb-6 relative z-10">
                            <div>
                              <p className="text-xs font-bold text-indigo-400 mb-1 flex items-center gap-1.5"><Film className="w-3 h-3"/> {resList[0].projectName}</p>
                              <p className="text-sm font-bold text-gray-500 mb-1">{theaterInfo.branch}</p>
                              <h3 className="text-2xl font-bold text-gray-900 tracking-tight">{theaterInfo.name}</h3>
                              <p className="text-gray-600 mt-1"><span className="text-gray-900 font-bold">{resList[0].userName}</span>님 외 {resList.length - 1}명</p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-gray-500 font-mono mb-2 uppercase tracking-widest">Assigned Seats</p>
                              <p className="text-xl font-bold font-mono text-gray-900 flex flex-wrap gap-2 justify-end">
                                {seatLabels.map(lbl => <span key={lbl} className="bg-gray-100 px-3 py-1 rounded-lg border border-gray-300 shadow-sm">{lbl}</span>)}
                              </p>
                            </div>
                          </div>
                          <div className="mt-4 pt-4 border-t border-gray-200 relative z-10">
                            {isAllCheckedIn ? (
                              <div className="w-full bg-green-500/10 border border-green-500/20 text-green-400 font-bold py-4 rounded-xl flex items-center justify-center gap-2">
                                <CheckCircle2 className="w-5 h-5" /> 티켓 수령이 완료되었습니다
                              </div>
                            ) : (
                              <button onClick={() => handleGuestCheckIn(theaterId, resList)} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-xl shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 active:scale-95 transition-all">
                                <TicketCheck className="w-5 h-5" /> 티켓 수령 확인
                              </button>
                            )}
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
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
            <div className="lg:col-span-4 space-y-8">
              <section className="space-y-4">
                <div className="flex gap-2 items-center justify-between">
                  <h2 className="text-sm font-mono text-gray-500 uppercase tracking-widest">상영관 선택</h2>
                </div>
                <div className="relative">
                  <select
                    value={selectedTheater?.id || ''}
                    onChange={(e) => setSelectedTheater(theaters.find(t => t.id === e.target.value) || null)}
                    className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 focus:outline-none focus:border-blue-500 transition-colors cursor-pointer appearance-none shadow-lg"
                  >
                    <option value="">관리할 상영관을 선택하세요</option>
                    {groupedTheaters.map(([branch, ths]) => (
                      <optgroup key={branch} label={branch} className="bg-white text-gray-600">
                        {ths.map(t => <option key={t.id} value={t.id} className="text-gray-900">{t.name} (총 {Object.keys(t.seats).length}석)</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none"><ChevronRight className="w-5 h-5 text-gray-500 rotate-90" /></div>
                </div>

                {selectedTheater && isAdmin && (
                  <div className="space-y-2 mt-2">
                    <button 
                      className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 font-bold py-3 text-sm rounded-xl transition-colors"
                      onClick={(e) => handleClearReservations(selectedTheater.id, e)}
                    >
                      현재 상영관 예약 데이터 초기화
                    </button>
                    
                    <div className="pt-4 border-t border-gray-200">
                      <p className="text-xs text-gray-500 mb-2 font-mono uppercase tracking-widest text-center">AI Auto Placement</p>
                      <button onClick={handleDownloadTemplate} className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-2.5 text-sm rounded-xl transition-colors mb-2 flex items-center justify-center gap-2">
                        <Download className="w-4 h-4" /> 엑셀 양식 다운로드
                      </button>
                      <button onClick={() => setShowExcelModal(true)} className="w-full bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 font-bold py-3 text-sm rounded-xl transition-colors text-center shadow-lg flex items-center justify-center gap-2">
                        <FileSpreadsheet className="w-4 h-4" /> 엑셀 자동 배정 시작
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {selectedTheater && !showAdmin && (
                <section className="p-6 bg-white rounded-2xl border border-gray-200 space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-xl font-bold flex items-center gap-2"><Check className="w-5 h-5 text-blue-500" /> 좌석 예약하기</h3>
                    <p className="text-sm text-gray-600">오른쪽 배치도에서 원하는 좌석을 여러 개 선택하시고 배정 정보를 입력하세요.</p>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-mono text-gray-500 uppercase">선택된 좌석 ({selectedSeats.length}개)</label>
                      <div className="min-h-[48px] bg-gray-50 border border-gray-200 rounded-lg flex flex-wrap items-center gap-2 p-2 shadow-inner">
                        {selectedSeats.length > 0 ? (
                          selectedSeats.map(seat => (
                            <div key={seat.id} className="bg-blue-600/20 border border-blue-500/30 text-blue-400 text-xs font-mono px-2 py-1 rounded flex items-center gap-1.5 shadow-sm">
                              {seat.label}
                              <button onClick={() => handleSeatClick(seat)} className="hover:bg-blue-500/20 rounded-full p-0.5 transition-colors"><X className="w-3 h-3" /></button>
                            </div>
                          ))
                        ) : <span className="text-gray-400 italic text-sm pl-2">지도에서 빈 좌석을 클릭하세요</span>}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <label className="text-xs font-mono text-gray-500 uppercase">소속/그룹명 (선택)</label>
                        <div className="relative">
                          <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                          <input type="text" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="소속명" className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500 transition-colors" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-mono text-gray-500 uppercase">성함 *</label>
                        <div className="relative">
                          <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                          <input type="text" value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="홍길동" className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500 transition-colors" />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-mono text-gray-500 uppercase">연락처 뒷자리 (4자리)</label>
                      <input type="text" maxLength={4} value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ''))} placeholder="예: 5678 (고객 조회용)" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500 transition-colors font-mono tracking-widest" />
                    </div>

                    <button onClick={handleReserve} disabled={selectedSeats.length === 0 || !userName || isReserving} className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-100 disabled:text-gray-400 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-blue-600/20 active:scale-95 mt-4">
                      {isReserving ? '처리 중...' : `${selectedSeats.length}개 좌석 예약 완료`}
                    </button>
                  </div>
                </section>
              )}

              <div className="p-4 bg-white/30 rounded-xl border border-gray-200/50 flex gap-3">
                <Info className="w-5 h-5 text-gray-500 shrink-0" />
                <p className="text-xs text-gray-500 leading-relaxed">
                  [관리자 가이드]<br/>
                  • 빈 좌석을 클릭해 예약을 배정할 수 있습니다.<br/>
                  • 선택한 좌석들(파란색)을 드래그 앤 드롭으로 <span className="text-blue-400 font-bold">배치 변경(이동)</span> 시킬 수 있습니다.<br/>
                  • 이미 배정 완료된 좌석(빨간색)을 클릭하면 취소 또는 수정 팝업이 나타납니다.
                </p>
              </div>
            </div>

            <div className="lg:col-span-8">
              <AnimatePresence mode="wait">
                {showAdmin ? (
                  <motion.div key="admin" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}><AdminPanel /></motion.div>
                ) : selectedTheater ? (
                  <motion.div key="map" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="space-y-6">
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-gray-200 pb-4">
                      <div>
                        <h2 className="text-2xl font-bold">{selectedTheater.name}</h2>
                        <p className="text-gray-500">{selectedTheater.branch}</p>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        <button onClick={handleClearProjectReservations} className="flex items-center gap-2 bg-red-900/20 hover:bg-red-900/40 border border-red-900/50 hover:border-red-500/50 text-sm text-red-400 py-2 px-4 rounded-lg transition-colors h-[42px]" title="프로젝트 전체 예약 삭제">
                          <AlertCircle className="w-4 h-4" /> 전체 예약 초기화
                        </button>
                        <div className="flex bg-white border border-gray-200 rounded-lg p-1">
                          <button onClick={() => setAdminViewMode('map')} className={cn("px-4 py-2 rounded text-sm font-bold transition-all flex items-center gap-2", adminViewMode === 'map' ? "bg-white border shadow-sm text-blue-600" : "text-gray-500 hover:text-gray-700")}>
                            <Map className="w-4 h-4" /> 배치도
                          </button>
                          <button onClick={() => setAdminViewMode('dashboard')} className={cn("px-4 py-2 rounded text-sm font-bold transition-all flex items-center gap-2", adminViewMode === 'dashboard' ? "bg-white border shadow-sm text-indigo-600" : "text-gray-500 hover:text-gray-700")}>
                            <LayoutDashboard className="w-4 h-4" /> 라이브 대시보드
                          </button>
                        </div>
                        <button onClick={handleExportCSV} className="flex items-center gap-2 bg-white hover:bg-gray-100 border border-gray-300 hover:border-gray-400 text-sm text-gray-700 py-2 px-4 rounded-lg transition-colors h-[42px]">
                          <Download className="w-4 h-4" /> 다운로드
                        </button>
                      </div>
                    </div>
                    
                    {adminViewMode === 'map' ? (
                      <SeatMap 
                        theater={selectedTheater} 
                        reservations={reservations}
                        selectedSeats={selectedSeats}
                        onSeatClick={handleSeatClick}
                        isAdmin={isAdmin}
                        onSeatDrop={handleSelectionDrop}
                      />
                    ) : (
                      dashboardStats && (
                        <div className="space-y-6 animate-fade-in">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-white p-5 rounded-2xl border border-gray-200">
                              <p className="text-sm text-gray-600 mb-1">총 배정 좌석</p>
                              <p className="text-3xl font-bold text-gray-900">{dashboardStats.totalAssigned}<span className="text-lg text-gray-500 ml-1">석</span></p>
                            </div>
                            <div className="bg-indigo-900/20 p-5 rounded-2xl border border-indigo-500/30">
                              <p className="text-sm text-indigo-400 mb-1 flex items-center gap-1"><TicketCheck className="w-4 h-4"/> 수령 완료</p>
                              <p className="text-3xl font-bold text-indigo-400">{dashboardStats.checkedIn}<span className="text-lg opacity-50 ml-1">석</span></p>
                            </div>
                            <div className="bg-red-900/10 p-5 rounded-2xl border border-red-500/20">
                              <p className="text-sm text-red-400 mb-1 flex items-center gap-1"><AlertCircle className="w-4 h-4"/> 미수령</p>
                              <p className="text-3xl font-bold text-red-400">{dashboardStats.pending}<span className="text-lg opacity-50 ml-1">석</span></p>
                            </div>
                            <div className="bg-white p-5 rounded-2xl border border-gray-200 relative overflow-hidden">
                              <p className="text-sm text-gray-600 mb-1">수령 진행률</p>
                              <p className="text-3xl font-bold text-gray-900">{dashboardStats.checkInRate}%</p>
                              <div className="absolute bottom-0 left-0 h-1.5 bg-gray-100 w-full">
                                <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${dashboardStats.checkInRate}%` }} />
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-col h-[500px]">
                              <h3 className="text-lg font-bold flex items-center gap-2 mb-4 text-gray-900"><Activity className="w-5 h-5 text-green-400" /> 실시간 수령 로그</h3>
                              <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                                {dashboardStats.recentLogs.length > 0 ? (
                                  dashboardStats.recentLogs.map(log => (
                                    <div key={log.id} className="bg-gray-50 p-3 rounded-xl border border-gray-200/50 flex justify-between items-center">
                                      <div>
                                        <div className="flex items-center gap-2 mb-1">
                                          <span className="bg-green-500/20 text-green-400 text-[10px] px-2 py-0.5 rounded font-bold border border-green-500/20">수령완료</span>
                                          <span className="font-bold text-gray-900 text-sm">{log.userName}</span>
                                          {log.groupName && <span className="text-xs text-gray-500">({log.groupName})</span>}
                                        </div>
                                        <p className="text-xs text-gray-600"><span className="text-gray-700 font-mono">{log.theaterName}</span> | 좌석: <span className="text-indigo-300 font-mono">{log.seatId}</span> / 뒷자리: {log.phoneLast4}</p>
                                      </div>
                                      <div className="text-right text-xs font-mono text-gray-500 flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {log.checkInTime?.toDate().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                      </div>
                                    </div>
                                  ))
                                ) : <div className="h-full flex items-center justify-center text-gray-400 text-sm">아직 수령한 인원이 없습니다.</div>}
                              </div>
                            </div>

                            <div className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-col h-[500px]">
                              <h3 className="text-lg font-bold flex items-center gap-2 mb-4 text-gray-900"><Users className="w-5 h-5 text-red-400" /> 미수령 대기자 명단</h3>
                              <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                                {dashboardStats.pendingLogs.length > 0 ? (
                                  dashboardStats.pendingLogs.map(log => (
                                    <div key={log.id} className="bg-gray-50 p-3 rounded-xl border border-red-900/20 flex justify-between items-center opacity-80 hover:opacity-100 transition-opacity">
                                      <div>
                                        <div className="flex items-center gap-2 mb-1">
                                          <span className="bg-red-500/10 text-red-400 text-[10px] px-2 py-0.5 rounded font-bold border border-red-500/20">대기중</span>
                                          <span className="font-bold text-gray-900 text-sm">{log.userName}</span>
                                        </div>
                                        <p className="text-xs text-gray-600"><span className="text-gray-700 font-mono">{log.theaterName}</span> | 좌석: <span className="text-gray-700 font-mono">{log.seatId}</span> / 뒷자리: {log.phoneLast4}</p>
                                      </div>
                                      {log.groupName && <div className="text-xs text-gray-500 truncate max-w-[100px] text-right">{log.groupName}</div>}
                                    </div>
                                  ))
                                ) : <div className="h-full flex items-center justify-center text-gray-400 text-sm">모든 인원이 티켓을 수령했습니다! 🎉</div>}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    )}
                  </motion.div>
                ) : <div className="h-[600px] flex items-center justify-center text-gray-400">상영관을 선택하세요.</div>}
              </AnimatePresence>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-8 border-t border-gray-200 py-10 px-6 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <p className="text-gray-400 text-sm">© 2026 Premiere Seat Manager. All rights reserved.</p>
        </div>
      </footer>

      {/* 🔥 엑셀 자동 배정 전용 모달 */}
      <AnimatePresence>
        {showExcelModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white border border-gray-200 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-6">
              <div>
                <h3 className="text-xl font-bold flex items-center gap-2 mb-1"><FileSpreadsheet className="w-5 h-5 text-indigo-400" /> 엑셀 명단 AI 자동 배정</h3>
                <p className="text-xs text-gray-600 leading-relaxed">선택한 상영관의 정중앙을 기준으로 직사각형 형태로 자동 배치합니다.</p>
              </div>
              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-mono text-gray-500 uppercase">1. 대관한 관이 어디인가요? (중복 선택 가능)</label>
                  <div className="max-h-48 overflow-y-auto bg-gray-50 border border-gray-200 rounded-lg p-2 space-y-2">
                    {groupedTheaters.map(([branch, ths]) => (
                      <div key={branch} className="space-y-1">
                        <div className="text-xs font-bold text-gray-500 px-2 pt-1">{branch}</div>
                        {ths.map(t => (
                          <label key={t.id} className="flex items-center gap-3 px-2 py-1.5 hover:bg-white rounded-md cursor-pointer transition-colors">
                            <input 
                              type="checkbox" 
                              checked={excelTheaterIds.includes(t.id)}
                              onChange={(e) => {
                                if (e.target.checked) setExcelTheaterIds(prev => [...prev, t.id]);
                                else setExcelTheaterIds(prev => prev.filter(id => id !== t.id));
                              }}
                              className="w-4 h-4 rounded bg-gray-100 border bg-gray-100 border-gray-300 text-indigo-500 focus:ring-0 focus:ring-offset-0"
                            />
                            <span className="text-sm text-gray-700">{t.name}</span>
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-mono text-gray-500 uppercase">2. 엑셀 파일 선택 (.xlsx)</label>
                  <div className="relative overflow-hidden w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-600 focus-within:border-indigo-500 transition-colors">
                    {excelFile ? <span className="text-gray-900">{excelFile.name}</span> : "파일 첨부"}
                    <input type="file" accept=".xlsx, .xls, .csv" onChange={(e) => { if (e.target.files?.length) setExcelFile(e.target.files[0]); }} className="absolute inset-0 opacity-0 cursor-pointer" />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => { setShowExcelModal(false); setExcelFile(null); setExcelTheaterIds([]); }} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900">취소</button>
                <button onClick={runExcelPlacement} disabled={excelTheaterIds.length === 0 || !excelFile || isReserving} className="px-6 py-2 rounded-lg text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white disabled:bg-gray-100">
                  {isReserving ? '배정 중...' : '배치 시작'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {dialog?.isOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white border border-gray-200 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
              <h3 className="text-lg font-bold mb-4 whitespace-pre-wrap leading-relaxed">{dialog.message}</h3>
              <div className="flex justify-end gap-3 mt-6">
                {dialog.type === 'confirm' && <button onClick={() => { dialog.onCancel?.(); setDialog(null); }} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900">취소</button>}
                <button onClick={() => { dialog.onConfirm?.(); setDialog(null); }} className={cn("px-4 py-2 rounded-lg text-sm font-bold", dialog.type === 'confirm' ? "bg-red-600 hover:bg-red-500 text-white" : "bg-blue-600 hover:bg-blue-500 text-white")}>확인</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingReservation && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white border border-gray-200 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xl font-bold flex items-center gap-2">예약 관리 <span className="text-blue-500 text-sm bg-blue-500/10 px-2 py-0.5 rounded font-mono">{editingReservation.seatId}</span></h3>
                  <button onClick={() => setEditingReservation(null)} className="text-gray-500 hover:text-gray-900"><X className="w-5 h-5" /></button>
                </div>
                <p className="text-xs text-gray-600">배정된 인원의 정보를 수정하거나 취소합니다.</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2"><label className="text-xs font-mono text-gray-500 uppercase">성함 *</label><input type="text" value={editForm.userName} onChange={e => setEditForm({...editForm, userName: e.target.value})} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-900 focus:border-blue-500" /></div>
                <div className="space-y-2"><label className="text-xs font-mono text-gray-500 uppercase">소속/그룹명</label><input type="text" value={editForm.groupName} onChange={e => setEditForm({...editForm, groupName: e.target.value})} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-900 focus:border-blue-500" /></div>
                <div className="space-y-2"><label className="text-xs font-mono text-gray-500 uppercase">연락처 뒷자리</label><input type="text" maxLength={4} value={editForm.phoneLast4} onChange={e => setEditForm({...editForm, phoneLast4: e.target.value.replace(/[^0-9]/g, '')})} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-900 font-mono tracking-widest focus:border-blue-500" /></div>
              </div>
              
              <div className="pt-2 flex flex-col gap-2">
                <button onClick={handleUpdateReservation} disabled={!editForm.userName} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl">정보 수정하기</button>
                <div className="grid grid-cols-2 gap-2 mt-4 border-t border-gray-200 pt-4">
                  <button onClick={handleCancelSingle} className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-500 font-bold py-3 text-sm rounded-xl border border-red-500/20">단건 취소</button>
                  {editingReservation.groupName && <button onClick={handleCancelGroup} className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 text-sm rounded-xl">그룹 취소</button>}
                </div>
                
                <div className="border-t border-gray-200 pt-4 mt-2 space-y-2">
                  <label className="text-xs font-mono text-gray-500 uppercase">타 상영관 배정 이동</label>
                  <div className="flex gap-2">
                    <select value={moveTargetTheaterId} onChange={e => setMoveTargetTheaterId(e.target.value)} className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900">
                      <option value="">이동할 상영관 선택...</option>
                      {theaters.filter(t => t.id !== selectedTheater?.id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <button onClick={handleMoveToAnotherTheater} disabled={!moveTargetTheaterId} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-100 text-white font-bold text-sm rounded-lg">이동</button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showProjectModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white border border-gray-200 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
              <h3 className="text-xl font-bold mb-2">새 프로젝트 만들기</h3>
              <p className="text-gray-600 text-sm mb-4">영화 제목 등 프로젝트 명을 입력하세요.</p>
              <input type="text" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder="예: 시사회_어벤져스" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-gray-900 mb-6" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleCreateProject(); }} />
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowProjectModal(false)} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900">취소</button>
                <button onClick={handleCreateProject} disabled={!newProjectName.trim()} className="px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 hover:bg-blue-500 disabled:bg-gray-100 disabled:text-gray-400 text-white">만들기</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}