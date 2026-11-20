import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import { AuthContext } from './authContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [signingIn, setSigningIn] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const applySession = (session: Session | null) => {
      if (!active) return
      setUser(session?.user ?? null)
      setSessionLoading(false)
    }

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          console.error('세션 조회 오류:', error.message)
        }
        applySession(data.session ?? null)
      })
      .catch((error) => {
        console.error('세션 조회 오류:', error)
        applySession(null)
      })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session)
      // 로그인/로그아웃 상태가 실제로 바뀌면 진행 중 표시는 해제
      setSigningIn(false)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  const signInWithGoogle = async () => {
    setAuthError(null)
    setSigningIn(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) {
      setSigningIn(false)
      setAuthError('구글 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.')
      console.error('구글 로그인 오류:', error.message)
    }
    // 성공 시에는 브라우저가 구글로 리디렉션되므로 별도 처리 불필요
  }

  const signOut = async () => {
    setAuthError(null)
    const { error } = await supabase.auth.signOut()
    if (error) {
      setAuthError('로그아웃에 실패했습니다. 다시 시도해 주세요.')
      console.error('로그아웃 오류:', error.message)
    }
  }

  const clearAuthError = () => setAuthError(null)

  return (
    <AuthContext.Provider
      value={{ user, sessionLoading, signingIn, authError, signInWithGoogle, signOut, clearAuthError }}
    >
      {children}
    </AuthContext.Provider>
  )
}
