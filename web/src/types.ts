import type { DayAssignment, DayValidation, Employee, Settings, Shift } from "./lib/rota";

export type { DayAssignment, DayValidation, Employee, Settings, Shift };

export type Role = "admin" | "member" | "viewer";

export interface Me {
  signedIn: boolean;
  authorized: boolean;
  role?: Role | null;
  canEdit?: boolean;
  email?: string;
  isAdmin?: boolean;
  displayName?: string;
  employeeId?: string | null;
}

export interface DayView {
  date: string;
  weekday: number;
  sealed: boolean;
  assignments: DayAssignment[];
  off: string[];
  validation: DayValidation;
}

export interface RotaResponse {
  from: string;
  to: string;
  days: DayView[];
  nextFrom: string;
}

export interface Branding {
  appName: string;
  primaryColor: string;
  hasLogo: boolean;
}
