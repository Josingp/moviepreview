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
  brand?: string;
  name: string;
  branch: string;
  rows: number;
  cols: number;
  seats: Record<string, Seat>; // key is "row-col"
}

export interface Reservation {
  id: string;
  projectId?: string;
  theaterId: string;
  seatId: string;
  userName: string;
  groupName?: string;
  phoneLast4?: string;
  reservedAt: Timestamp;
  // 👇 아래 두 줄이 새로 추가된 체크인 데이터입니다.
  isCheckedIn?: boolean;
  checkInTime?: Timestamp;
}

export interface Project {
  id: string;
  name: string;
  createdAt: Timestamp;
}
