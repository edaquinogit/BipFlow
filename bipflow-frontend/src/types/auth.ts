export interface LoginCredentials { email: string; password: string; captcha_token?: string; remember_me?: boolean; }
export interface LoginResponse { access: string; }
export interface MfaChallengeResponse { mfa_required: true; mfa_token: string; }
export type LoginResult = LoginResponse | MfaChallengeResponse;
export interface MfaVerifyPayload { mfa_token: string; code?: string; backup_code?: string; }
export interface MfaDisablePayload { password: string; code?: string; backup_code?: string; }
export interface MfaSetupResponse { secret: string; provisioning_uri: string; qr_code: string; }
export interface MfaSetupConfirmResponse { message: string; backup_codes: string[]; }
export interface CurrentUser {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  is_staff: boolean;
  is_superuser: boolean;
  roles: string[];
  can_access_dashboard: boolean;
  can_manage_catalog: boolean;
  can_manage_orders: boolean;
  mfa_enabled: boolean;
}
export interface RegisterPayload {
  email: string;
  password: string;
  confirm_password: string;
  registration_context?: 'dashboard_owner' | 'storefront_customer';
  store_name?: string;
  store_slug?: string;
  full_name?: string;
  phone?: string;
  address?: string;
  neighborhood?: string;
  city?: string;
}
export interface RegisterResponse { message: string; email: string; profile_kind?: string; registration_context?: string; }
export interface RequestResetPayload { email: string; }
export interface RequestResetResponse { message: string; }
export interface ConfirmResetPayload { uid: string; token: string; password: string; confirm_password: string; }
export interface ConfirmResetResponse { message: string; email: string; }
export interface ApiError { response?: { status?: number; data?: { detail?: string; message?: string; [key: string]: any; }; }; }
