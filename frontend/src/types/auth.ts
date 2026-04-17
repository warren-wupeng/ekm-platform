export interface User {
  id: string
  username: string
  email: string
  displayName: string
  avatar?: string
  department?: string
  roles: string[]
}

export interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
}

export interface LoginResponse {
  access_token: string
  refresh_token: string
  token_type: string
  user: User
}
