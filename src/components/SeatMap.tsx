import React from 'react';
import { motion } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { Seat, Reservation } from '@/src/types';
import { User, Armchair, Accessibility } from 'lucide-react';

interface SeatMapProps {
  theater: {
    rows: number;
    cols: number;
    seats: Record<string, Seat>;
  };
  reservations: Record<string, Reservation>;
  selectedSeats: Seat[];
  onSeatClick: (seat: Seat) => void;
  isAdmin?: boolean;
  onSeatDrop?: (sourceSeatId: string, targetSeatId: string) => void;
}

export const SeatMap: React.FC<SeatMapProps> = ({ theater, reservations, selectedSeats, onSeatClick, isAdmin, onSeatDrop }) => {
  const rowLabels = Array.from(new Set((Object.values(theater.seats) as Seat[]).map(s => s.row))).sort();
  const colIndices = Array.from({ length: theater.cols }, (_, i) => i + 1);

  return (
    <div className="w-full p-4 sm:p-6 md:p-8 bg-zinc-950 rounded-xl border border-zinc-800 shadow-2xl flex justify-center">
      <div className="w-full max-w-full flex flex-col items-center gap-6 md:gap-8">
        {/* Screen */}
        <div className="w-full max-w-2xl h-2 bg-zinc-700 rounded-full relative mb-12">
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-zinc-500 text-xs font-mono uppercase tracking-widest">
            SCREEN
          </div>
          <div className="absolute top-0 left-0 w-full h-12 bg-gradient-to-b from-zinc-700/20 to-transparent blur-xl" />
        </div>

        {/* Seats Grid */}
        <div className="w-full grid gap-1 sm:gap-2">
          {rowLabels.map(row => (
            <div key={row} className="flex items-center gap-1 sm:gap-4 w-full">
              <div className="w-4 sm:w-6 text-zinc-600 font-mono text-[9px] sm:text-sm font-bold text-center shrink-0">{row}</div>
              <div 
                className="flex-1 grid gap-[1px] sm:gap-1"
                style={{ gridTemplateColumns: `repeat(${theater.cols}, minmax(0, 1fr))` }}
              >
                {colIndices.map(col => {
                  const seatId = `${row}-${col}`;
                  const seat = theater.seats[seatId];
                  const reservation = reservations[seatId];

                  if (!seat || seat.type === 'empty') {
                    return <div key={col} className="w-full aspect-square" />;
                  }

                  const isReserved = !!reservation;
                  const isSelected = selectedSeats.some(s => s.id === seat.id);

                  return (
                    <motion.button
                      key={col}
                      draggable={isSelected}
                      onDragStart={(e) => {
                        if (isSelected) {
                          e.dataTransfer.setData('sourceSeatId', seat.id);
                        } else {
                          e.preventDefault();
                        }
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (!onSeatDrop) return;
                        const sourceSeatId = e.dataTransfer.getData('sourceSeatId');
                        if (sourceSeatId && sourceSeatId !== seat.id) {
                          onSeatDrop(sourceSeatId, seat.id);
                        }
                      }}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => onSeatClick(seat)}
                      className={cn(
                        "w-full aspect-square rounded-[2px] sm:rounded-md flex items-center justify-center transition-colors relative group",
                        isReserved 
                          ? "bg-red-500/20 border border-red-500/50 text-red-500 cursor-not-allowed opacity-80" 
                          : isSelected
                            ? "bg-blue-600 border sm:border-2 border-blue-400 text-white shadow-[0_0_10px_rgba(37,99,235,0.5)] z-10"
                            : seat.type === 'disabled'
                              ? "bg-cyan-500/20 border border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/40"
                              : seat.type === 'sweetbox'
                                ? "bg-pink-500/20 border border-pink-500/50 text-pink-400 hover:bg-pink-500/40"
                                : "bg-zinc-900 border border-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:border-zinc-500 hover:text-zinc-200"
                      )}
                    >
                      {isReserved ? (
                        <User className="w-1/2 h-1/2" />
                      ) : seat.type === 'disabled' ? (
                        <Accessibility className="w-1/2 h-1/2" />
                      ) : (
                        theater.cols <= 40 && <span className="text-[7px] sm:text-[10px] font-mono hidden sm:inline-block">{seat.label.replace(seat.row, '')}</span>
                      )}
                      
                      {/* Tooltip */}
                      <div className="absolute bottom-full mb-2 hidden group-hover:block z-50 pointer-events-none">
                        <div className="bg-zinc-800 border border-zinc-700 text-white text-xs py-1.5 px-3 rounded whitespace-nowrap shadow-xl">
                          <span className="font-bold text-blue-400 mr-2">{seat.label}</span> 
                          <span className="text-zinc-400 mr-1">
                            {seat.type === 'disabled' ? '(장애인석)' : seat.type === 'sweetbox' ? '(스위트박스)' : ''}
                          </span>
                          {isReserved ? `예약됨: ${reservation.groupName ? reservation.groupName + ' ' : ''}${reservation.userName}` : '선택 가능'}
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
              <div className="w-4 sm:w-6 text-zinc-600 font-mono text-[9px] sm:text-sm font-bold text-center shrink-0">{row}</div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 sm:gap-6 mt-8 p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-md bg-zinc-900 border border-zinc-800" />
            <span className="text-xs text-zinc-400">일반석</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-md bg-pink-500/20 border border-pink-500/50" />
            <span className="text-xs text-zinc-400">스위트박스</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-md bg-cyan-500/20 border border-cyan-500/50 flex items-center justify-center">
              <Accessibility className="w-3 h-3 text-cyan-400" />
            </div>
            <span className="text-xs text-zinc-400">장애인석</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-md bg-blue-600 border border-blue-500" />
            <span className="text-xs text-zinc-400">선택됨</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-md bg-red-500/20 border border-red-500/50 flex items-center justify-center">
              <User className="w-3 h-3 text-red-500" />
            </div>
            <span className="text-xs text-zinc-400">예약됨</span>
          </div>
        </div>
      </div>
    </div>
  );
};
