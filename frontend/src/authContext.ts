import { createContext } from 'react'
import type { User } from '@supabase/supabase-js'

export type AuthContextValue = {
  user: User | null
  sessionLoading: boolean // 새로고침 직후 세션 복원 중인지
  signingIn: boolean // 구글 로그인 리디렉션 진행 중인지
  authError: string | null
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  clearAuthError: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
