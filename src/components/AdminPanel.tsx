import React, { useState } from 'react';
import { Theater, Seat } from '@/src/types';
import { db } from '@/src/firebase';
import { collection, addDoc, doc, setDoc } from 'firebase/firestore';
import { Upload, CheckCircle2, AlertCircle } from 'lucide-react';

export const AdminPanel: React.FC = () => {
  const [jsonInput, setJsonInput] = useState('');
  const [theaterName, setTheaterName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');

  const parseCGVData = (data: any): Record<string, Seat> => {
    const seats: Record<string, Seat> = {};
    
    // CGV seatArr is usually a 2D array
    if (Array.isArray(data)) {
      data.forEach((rowArr: any[], rowIndex) => {
        rowArr.forEach((seatData: any, colIndex) => {
          if (!seatData || seatData.seatStusCd === '9') return; // Skip empty/blocked

          const rowNm = seatData.seatRowNm || String.fromCharCode(65 + rowIndex);
          const seatNo = seatData.seatNo || (colIndex + 1).toString();
          const id = `${rowNm}-${seatNo}`;

          seats[id] = {
            id,
            row: rowNm,
            col: parseInt(seatNo),
            label: `${rowNm}${seatNo}`,
            type: seatData.szoneKindCd === '04' ? 'sweetbox' : 'normal'
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
      // Handle different possible structures (direct array or nested in chooseSeatMyself)
      const seatData = parsed.chooseSeatMyself?.seatArr || parsed.seatArr || parsed;
      
      const seats = parseCGVData(seatData);
      
      const rows = Array.from(new Set(Object.values(seats).map(s => s.row))).length;
      const cols = Math.max(...Object.values(seats).map(s => s.col));

      const theater: Omit<Theater, 'id'> = {
        name: theaterName,
        branch: branchName,
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

  return (
    <div className="p-6 bg-zinc-900 rounded-xl border border-zinc-800 space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <Upload className="w-5 h-5 text-blue-400" />
        <h2 className="text-xl font-bold text-white">상영관 데이터 임포트</h2>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-xs font-mono text-zinc-500 uppercase">상영관 이름</label>
          <input 
            type="text" 
            value={theaterName}
            onChange={(e) => setTheaterName(e.target.value)}
            placeholder="예: 1관, IMAX관"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-mono text-zinc-500 uppercase">지점명</label>
          <input 
            type="text" 
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            placeholder="예: CGV 용산아이파크몰"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-mono text-zinc-500 uppercase">CGV 좌석 JSON 데이터</label>
        <textarea 
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
          placeholder="CGV 홈페이지의 seatArr JSON 데이터를 붙여넣으세요..."
          className="w-full h-48 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white font-mono text-xs focus:outline-none focus:border-blue-500 transition-colors resize-none"
        />
      </div>

      <button 
        onClick={handleImport}
        disabled={status === 'loading'}
        className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
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
  );
};
