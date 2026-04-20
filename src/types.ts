import { Timestamp } from 'firebase/firestore';

export interface Seat {
  id: string; // e.g., "A-12"
  row: string; // e.g., "A"
  col: number; // e.g., 12
  type: 'normal' | 'disabled' | 'sweetbox' | 'empty';
  label: string;
}

export interface Theater {
  id: string;
  name: string;
  branch: string;
  rows: number;
  cols: number;
  seats: Record<string, Seat>; // key is "row-col"
}

export interface Reservation {
  id: string;
  theaterId: string;
  seatId: string;
  userName: string;
  reservedAt: Timestamp;
}
