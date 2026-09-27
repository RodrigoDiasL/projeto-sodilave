export const UserRole = {
  OPERATOR: "OPERATOR",
  PRODUCTION_MANAGER: "PRODUCTION_MANAGER",
  LOGISTICS: "LOGISTICS",
  AUDITOR: "AUDITOR",
  ADMIN: "ADMIN",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const RecordStatus = {
  DRAFT: "DRAFT",
  FINALIZED: "FINALIZED",
  CANCELLED: "CANCELLED",
} as const;
export type RecordStatus = (typeof RecordStatus)[keyof typeof RecordStatus];

export const LotStatus = {
  ACTIVE: "ACTIVE",
  DEPLETED: "DEPLETED",
  CLOSED: "CLOSED",
  CANCELLED: "CANCELLED",
} as const;
export type LotStatus = (typeof LotStatus)[keyof typeof LotStatus];

export const TestResult = {
  CONFORMING: "CONFORMING",
  NON_CONFORMING: "NON_CONFORMING",
  NOT_PERFORMED: "NOT_PERFORMED",
  NOT_APPLICABLE: "NOT_APPLICABLE",
} as const;
export type TestResult = (typeof TestResult)[keyof typeof TestResult];

export const TestType = {
  LEAK: "LEAK",
  DROP: "DROP",
} as const;
export type TestType = (typeof TestType)[keyof typeof TestType];

export const TestMoment = {
  START: "START",
  MID: "MID",
  END: "END",
} as const;
export type TestMoment = (typeof TestMoment)[keyof typeof TestMoment];

export const OilLevel = {
  LOW: "LOW",
  NORMAL: "NORMAL",
  HIGH: "HIGH",
} as const;
export type OilLevel = (typeof OilLevel)[keyof typeof OilLevel];

export const MachineStatus = {
  RUNNING: "RUNNING",
  STOPPED: "STOPPED",
} as const;
export type MachineStatus = (typeof MachineStatus)[keyof typeof MachineStatus];

export const MaintenanceType = {
  PREVENTIVE: "PREVENTIVE",
  CORRECTIVE: "CORRECTIVE",
  SCHEDULED: "SCHEDULED",
} as const;
export type MaintenanceType = (typeof MaintenanceType)[keyof typeof MaintenanceType];

export const MaintenanceStatus = {
  OPEN: "OPEN",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;
export type MaintenanceStatus = (typeof MaintenanceStatus)[keyof typeof MaintenanceStatus];

export const IncidentType = {
  BREAKDOWN: "BREAKDOWN",
  STOPPAGE: "STOPPAGE",
  OTHER: "OTHER",
} as const;
export type IncidentType = (typeof IncidentType)[keyof typeof IncidentType];

export const MachineEventType = {
  WEEKLY_STARTUP: "WEEKLY_STARTUP",
  INTERMEDIATE_STARTUP: "INTERMEDIATE_STARTUP",
  BREAKDOWN_STOP: "BREAKDOWN_STOP",
  MANUAL_STOP: "MANUAL_STOP",
  MAINTENANCE_START: "MAINTENANCE_START",
  MAINTENANCE_END: "MAINTENANCE_END",
  WEEKLY_SHUTDOWN: "WEEKLY_SHUTDOWN",
} as const;
export type MachineEventType = (typeof MachineEventType)[keyof typeof MachineEventType];
