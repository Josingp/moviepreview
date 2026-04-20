import React, { useState, useEffect } from 'react';
import { db, auth } from './firebase';
import { 
  collection, 
  onSnapshot, 
  doc, 
  setDoc, 
  query, 
  where,
  Timestamp,
  deleteDoc
} from 'firebase/firestore';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider,
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { Theater, Seat, Reservation } from './types';
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
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  
  const [theaters, setTheaters] = useState<Theater[]>([]);
  const [selectedTheater, setSelectedTheater] = useState<Theater | null>(null);
  const [reservations, setReservations] = useState<Record<string, Reservation>>({});
  
  const [userName, setUserName] = useState('');
  const [selectedSeat, setSelectedSeat] = useState<Seat | null>(null);
  const [isReserving, setIsReserving] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAdmin(u?.email === 'mcfly0803@gmail.com');
    });
    return () => unsubscribe();
  }, []);

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
    if (!selectedTheater) return;
    
    const q = query(collection(db, 'reservations'), where('theaterId', '==', selectedTheater.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const resMap: Record<string, Reservation> = {};
      snapshot.docs.forEach(d => {
        const data = d.data() as Reservation;
        resMap[data.seatId] = { id: d.id, ...data };
      });
      setReservations(resMap);
    });
    return () => unsubscribe();
  }, [selectedTheater]);

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
    if (!selectedTheater || !selectedSeat || !userName) return;
    
    setIsReserving(true);
    try {
      const reservationId = `${selectedTheater.id}_${selectedSeat.id}`;
      await setDoc(doc(db, 'reservations', reservationId), {
        theaterId: selectedTheater.id,
        seatId: selectedSeat.id,
        userName: userName,
        reservedAt: Timestamp.now()
      });
      setSelectedSeat(null);
    } catch (err) {
      console.error(err);
      alert('예약 중 오류가 발생했습니다.');
    } finally {
      setIsReserving(false);
    }
  };

  const handleCancelReservation = async (seatId: string) => {
    if (!selectedTheater || !isAdmin) return;
    if (!confirm('이 예약을 취소하시겠습니까?')) return;

    try {
      const reservationId = `${selectedTheater.id}_${seatId}`;
      await deleteDoc(doc(db, 'reservations', reservationId));
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-blue-500/30">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
              <Film className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">시사회 좌석 관리</h1>
              <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">Premiere Seat Manager</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {isAdmin && (
              <button 
                onClick={() => setShowAdmin(!showAdmin)}
                className={cn(
                  "p-2 rounded-lg transition-colors",
                  showAdmin ? "bg-blue-600 text-white" : "text-zinc-400 hover:bg-zinc-800"
                )}
              >
                <Settings className="w-5 h-5" />
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

      <main className="max-w-7xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          
          {/* Left Column: Controls & Info */}
          <div className="lg:col-span-4 space-y-8">
            <section className="space-y-4">
              <h2 className="text-sm font-mono text-zinc-500 uppercase tracking-widest">상영관 선택</h2>
              <div className="flex flex-col gap-2">
                {theaters.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTheater(t)}
                    className={cn(
                      "w-full flex items-center justify-between p-4 rounded-xl border transition-all",
                      selectedTheater?.id === t.id 
                        ? "bg-blue-600/10 border-blue-500 text-blue-400" 
                        : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                    )}
                  >
                    <div className="text-left">
                      <p className="font-bold">{t.name}</p>
                      <p className="text-xs opacity-60">{t.branch}</p>
                    </div>
                    <ChevronRight className={cn("w-5 h-5 transition-transform", selectedTheater?.id === t.id && "rotate-90")} />
                  </button>
                ))}
                {theaters.length === 0 && (
                  <div className="p-8 text-center bg-zinc-900 rounded-xl border border-dashed border-zinc-800 text-zinc-500">
                    등록된 상영관이 없습니다.
                  </div>
                )}
              </div>
            </section>

            {selectedTheater && (
              <section className="p-6 bg-zinc-900 rounded-2xl border border-zinc-800 space-y-6">
                <div className="space-y-2">
                  <h3 className="text-xl font-bold">좌석 예약하기</h3>
                  <p className="text-sm text-zinc-400">원하는 좌석을 선택하고 이름을 입력하세요.</p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-mono text-zinc-500 uppercase">성함</label>
                    <div className="relative">
                      <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                      <input 
                        type="text" 
                        value={userName}
                        onChange={(e) => setUserName(e.target.value)}
                        placeholder="이름을 입력하세요"
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-10 pr-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-mono text-zinc-500 uppercase">선택된 좌석</label>
                    <div className="h-12 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center px-4 text-sm font-mono">
                      {selectedSeat ? (
                        <span className="text-blue-400 font-bold">{selectedSeat.label}</span>
                      ) : (
                        <span className="text-zinc-600 italic">좌석을 선택해주세요</span>
                      )}
                    </div>
                  </div>

                  <button 
                    onClick={handleReserve}
                    disabled={!selectedSeat || !userName || isReserving}
                    className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-blue-600/20 active:scale-95"
                  >
                    {isReserving ? '처리 중...' : '예약 완료'}
                  </button>
                </div>
              </section>
            )}

            <div className="p-4 bg-zinc-900/30 rounded-xl border border-zinc-800/50 flex gap-3">
              <Info className="w-5 h-5 text-zinc-500 shrink-0" />
              <p className="text-xs text-zinc-500 leading-relaxed">
                시사회 좌석은 선착순으로 배정됩니다. 이미 예약된 좌석은 선택할 수 없습니다.
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
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-bold">{selectedTheater.name}</h2>
                      <p className="text-zinc-500">{selectedTheater.branch}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-mono font-bold text-blue-500">
                        {Object.keys(reservations).length} / {Object.keys(selectedTheater.seats).length}
                      </p>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Reserved Seats</p>
                    </div>
                  </div>
                  
                  <SeatMap 
                    theater={selectedTheater} 
                    reservations={reservations}
                    onSeatClick={(seat) => {
                      if (reservations[seat.id]) {
                        if (isAdmin) handleCancelReservation(seat.id);
                        return;
                      }
                      setSelectedSeat(seat);
                    }}
                  />
                </motion.div>
              ) : (
                <div className="h-[600px] flex flex-col items-center justify-center text-zinc-600 space-y-4 border border-dashed border-zinc-800 rounded-3xl">
                  <Film className="w-16 h-16 opacity-20" />
                  <p>상영관을 선택하면 좌석 배치도가 나타납니다.</p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-20 border-t border-zinc-900 py-10 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <p className="text-zinc-600 text-sm">© 2026 Premiere Seat Manager. All rights reserved.</p>
          <div className="flex gap-6 text-zinc-600 text-sm">
            <a href="#" className="hover:text-zinc-400 transition-colors">이용약관</a>
            <a href="#" className="hover:text-zinc-400 transition-colors">개인정보처리방침</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
