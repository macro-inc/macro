export interface LinkedInProfile {
  name: string;
  headline?: string;
  company?: string;
  title?: string;
  location?: string;
  profileUrl: string;
  connectionDegree?: string;
}

export interface ExtractedContact {
  name: string;
  email?: string;
  company?: string;
  title?: string;
  location?: string;
  linkedinUrl: string;
}

export interface MacroConfig {
  apiToken: string;
  baseUrl: string;
}

export interface CrmCompany {
  id: string;
  name: string;
  domain?: string;
}

export interface CrmContact {
  id: string;
  name: string;
  email: string;
  companyId: string;
}

export type MessageType =
  | { type: 'GET_PROFILE_DATA' }
  | { type: 'ADD_TO_CRM'; profile: LinkedInProfile }
  | { type: 'CHECK_AUTH' }
  | { type: 'OPEN_OPTIONS' };

export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
