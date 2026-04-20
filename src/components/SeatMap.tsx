import React from 'react';
import { motion } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { Seat, Reservation } from '@/src/types';
import { User, Armchair } from 'lucide-react';

interface SeatMapProps {
  theater: {
    rows: number;
    cols: number;
    seats: Record<string, Seat>;
  };
  reservations: Record<string, Reservation>;
  onSeatClick: (seat: Seat) => void;
}

export const SeatMap: React.FC<SeatMapProps> = ({ theater, reservations, onSeatClick }) => {
  const rowLabels = Array.from(new Set((Object.values(theater.seats) as Seat[]).map(s => s.row))).sort();
  const colIndices = Array.from({ length: theater.cols }, (_, i) => i + 1);

  return (
    <div className="overflow-auto p-8 bg-zinc-950 rounded-xl border border-zinc-800 shadow-2xl">
      <div className="min-w-max flex flex-col items-center gap-8">
        {/* Screen */}
        <div className="w-full max-w-2xl h-2 bg-zinc-700 rounded-full relative mb-12">
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-zinc-500 text-xs font-mono uppercase tracking-widest">
            SCREEN
          </div>
          <div className="absolute top-0 left-0 w-full h-12 bg-gradient-to-b from-zinc-700/20 to-transparent blur-xl" />
        </div>

        {/* Seats Grid */}
        <div className="grid gap-2">
          {rowLabels.map(row => (
            <div key={row} className="flex items-center gap-4">
              <div className="w-6 text-zinc-600 font-mono text-sm font-bold">{row}</div>
              <div className="flex gap-1.5">
                {colIndices.map(col => {
                  const seatId = `${row}-${col}`;
                  const seat = theater.seats[seatId];
                  const reservation = reservations[seatId];

                  if (!seat || seat.type === 'empty') {
                    return <div key={col} className="w-8 h-8" />;
                  }

                  const isReserved = !!reservation;

                  return (
                    <motion.button
                      key={col}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => onSeatClick(seat)}
                      className={cn(
                        "w-8 h-8 rounded-md flex items-center justify-center transition-colors relative group",
                        isReserved 
                          ? "bg-red-500/20 border border-red-500/50 text-red-400" 
                          : "bg-zinc-800 border border-zinc-700 text-zinc-400 hover:bg-zinc-700 hover:border-zinc-600"
                      )}
                      title={isReserved ? `${seat.label} - ${reservation.userName}` : seat.label}
                    >
                      {isReserved ? (
                        <User className="w-4 h-4" />
                      ) : (
                        <span className="text-[10px] font-mono">{col}</span>
                      )}
                      
                      {/* Tooltip */}
                      <div className="absolute bottom-full mb-2 hidden group-hover:block z-50">
                        <div className="bg-zinc-900 border border-zinc-700 text-white text-xs py-1 px-2 rounded whitespace-nowrap shadow-xl">
                          {seat.label} {isReserved && `(${reservation.userName})`}
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
              <div className="w-6 text-zinc-600 font-mono text-sm font-bold">{row}</div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex gap-6 mt-8 p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-zinc-800 border border-zinc-700" />
            <span className="text-xs text-zinc-400">선택 가능</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-red-500/20 border border-red-500/50" />
            <span className="text-xs text-zinc-400">예약됨</span>
          </div>
        </div>
      </div>
    </div>
  );
};
