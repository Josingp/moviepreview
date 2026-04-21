import React, { useState, useEffect } from 'react';
import { Theater, Seat } from '@/src/types';
import { db } from '@/src/firebase';
import { collection, addDoc, doc, onSnapshot, writeBatch, query, where, getDocs, deleteDoc } from 'firebase/firestore';
import { Upload, CheckCircle2, AlertCircle, FileSpreadsheet, Trash2 } from 'lucide-react';

export const AdminPanel: React.FC = () => {
  const [jsonInput, setJsonInput] = useState('');
  const [theaterName, setTheaterName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [brandName, setBrandName] = useState('CGV');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');

  const [theaters, setTheaters] = useState<Theater[]>([]);
  
  // 위험 구역 (상영관 삭제용) 상태
  const [deleteTheaterId, setDeleteTheaterId] = useState<string>('');

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'theaters'), (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Theater));
      setTheaters(docs);
    });
    return () => unsubscribe();
  }, []);

  const parseCGVData = (data: any): Record<string, Seat> => {
    const seats: Record<string, Seat> = {};
    
    if (Array.isArray(data)) {
      data.forEach((rowArr: any[], rowIndex) => {
        if (!Array.isArray(rowArr)) return;
        
        rowArr.forEach((seatData: any, colIndex) => {
          if (!seatData || seatData.seatStusCd === '9') return; 

          const rowNm = seatData.seatRowNm || String.fromCharCode(65 + rowIndex);
          const seatNo = seatData.seatNo || (colIndex + 1).toString();
          const id = `${rowNm}-${colIndex + 1}`;

          seats[id] = {
            id,
            row: rowNm,
            col: colIndex + 1,
            label: `${rowNm}${seatNo}`,
            type: (seatData.customType || (seatData.szoneKindCd === '04' ? 'sweetbox' : 'normal')) as 'normal' | 'disabled' | 'sweetbox'
          };
        });
      });
    }
    return seats;
  };

  const handleImport = async () => {
    if (!jsonInput || !theaterName) {
      setError('상영관 이름과 데이터를 입력해주세요.');
      setStatus('error');
      return;
    }

    try {
      setStatus('loading');
      const parsed = JSON.parse(jsonInput);
      const seatData = parsed.chooseSeatMyself?.seatArr || parsed.seatArr || parsed;
      const seats = parseCGVData(seatData);
      
      const rows = Array.from(new Set(Object.values(seats).map(s => s.row))).length;
      const cols = Math.max(...Object.values(seats).map(s => s.col));

      const theater: Omit<Theater, 'id'> = {
        name: theaterName,
        branch: branchName,
        brand: brandName,
        rows,
        cols,
        seats
      };

      await addDoc(collection(db, 'theaters'), theater);
      
      setStatus('success');
      setJsonInput('');
      setTheaterName('');
    } catch (err) {
      console.error(err);
      setError('데이터 파싱 중 오류가 발생했습니다. 올바른 JSON 형식인지 확인해주세요.');
      setStatus('error');
    }
  };

  // 🔥 상영관 뼈대 데이터 완전 삭제 (비밀번호 확인)
  const handleDeleteTheaterComplete = async () => {
    if (!deleteTheaterId) return;

    const pwd = prompt('이 작업은 매우 위험합니다.\n상영관 구조 데이터를 완전히 삭제하려면 비밀번호를 입력하세요.');
    
    if (pwd !== '960223') {
      alert('비밀번호가 일치하지 않습니다. 삭제가 취소되었습니다.');
      return;
    }

    if (!window.confirm('정말 삭제하시겠습니까?\n이 상영관을 사용 중인 모든 프로젝트의 예약 데이터와 좌석 뼈대가 영구적으로 삭제됩니다.')) {
      return;
    }

    try {
      // 1. 해당 상영관의 모든 예약 내역 먼저 싹 지우기
      const q = query(collection(db, 'reservations'), where('theaterId', '==', deleteTheaterId));
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

      // 2. 상영관 자체 문서(뼈대) 지우기
      await deleteDoc(doc(db, 'theaters', deleteTheaterId));
      
      alert('상영관 데이터가 완전히 삭제되었습니다.');
      setDeleteTheaterId('');
    } catch (err: any) {
      console.error(err);
      alert(`삭제 중 오류 발생: ${err.message}`);
    }
  };

  return (
    <div className="space-y-8">
      {/* 1. 상영관 세팅 영역 */}
      <div className="p-6 bg-gray-50 rounded-xl border border-gray-200 space-y-6">
        <div className="flex items-center gap-2 mb-4">
          <Upload className="w-5 h-5 text-blue-500" />
          <h2 className="text-xl font-bold text-gray-900">1. 상영관 좌석틀 생성 (JSON)</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-mono text-gray-500 uppercase">브랜드</label>
            <select 
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-lg px-4 py-2 text-gray-900 focus:outline-none focus:border-blue-500 transition-colors appearance-none cursor-pointer"
            >
              <option value="CGV">CGV</option>
              <option value="롯데시네마">롯데시네마</option>
              <option value="메가박스">메가박스</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-mono text-gray-500 uppercase">상영관 이름</label>
            <input 
              type="text" 
              value={theaterName}
              onChange={(e) => setTheaterName(e.target.value)}
              placeholder="예: 1관, IMAX관"
              className="w-full bg-white border border-gray-200 rounded-lg px-4 py-2 text-gray-900 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-mono text-gray-500 uppercase">지점명</label>
            <input 
              type="text" 
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="예: 용산아이파크몰"
              className="w-full bg-white border border-gray-200 rounded-lg px-4 py-2 text-gray-900 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-mono text-gray-500 uppercase">CGV 좌석 JSON 데이터</label>
          <textarea 
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder="CGV 홈페이지의 seatArr JSON 데이터를 붙여넣으세요..."
            className="w-full h-48 bg-white border border-gray-200 rounded-lg px-4 py-2 text-gray-900 font-mono text-xs focus:outline-none focus:border-blue-500 transition-colors resize-none"
          />
        </div>

        <button 
          onClick={handleImport}
          disabled={status === 'loading'}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-100 disabled:text-gray-400 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm"
        >
          {status === 'loading' ? '처리 중...' : '데이터 임포트'}
        </button>

        {status === 'success' && (
          <div className="flex items-center gap-2 text-green-400 bg-green-400/10 p-3 rounded-lg border border-green-400/20">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-sm">상영관 데이터가 성공적으로 저장되었습니다.</span>
          </div>
        )}

        {status === 'error' && (
          <div className="flex items-center gap-2 text-red-400 bg-red-400/10 p-3 rounded-lg border border-red-400/20">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
          </div>
        )}
      </div>

      {/* 2. 위험 구역 (상영관 데이터 완전 삭제) */}
      <div className="p-6 bg-white rounded-xl border border-red-200 space-y-6 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Trash2 className="w-5 h-5 text-red-500" />
          <h2 className="text-xl font-bold text-red-500">2. 상영관 데이터 완전 삭제 (위험)</h2>
        </div>
        
        <p className="text-sm text-gray-500">
          좌석 뼈대 데이터 자체를 DB에서 완전히 삭제합니다. 한 번 삭제하면 복구할 수 없으며, 작업을 위해 시스템 마스터 비밀번호가 필요합니다.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={deleteTheaterId}
            onChange={(e) => setDeleteTheaterId(e.target.value)}
            className="flex-1 bg-gray-50 border border-red-200 rounded-lg px-4 py-3 text-gray-900 focus:outline-none focus:border-red-500 transition-colors"
          >
            <option value="" disabled>삭제할 상영관 선택</option>
            {theaters.map(t => (
              <option key={t.id} value={t.id}>[{t.brand || 'CGV'}] {t.name} ({t.branch})</option>
            ))}
          </select>
          <button
            onClick={handleDeleteTheaterComplete}
            disabled={!deleteTheaterId}
            className="px-6 py-3 bg-red-600 hover:bg-red-500 disabled:bg-gray-100 disabled:text-gray-400 text-white font-bold rounded-lg transition-colors whitespace-nowrap"
          >
            영구 삭제
          </button>
        </div>
      </div>
    </div>
  );
};