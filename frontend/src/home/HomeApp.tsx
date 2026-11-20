import type { ReactNode } from 'react'
import { useAuth } from '../useAuth.ts'
import { MapIllustration, MealcardIllustration } from './Illustrations.tsx'
import { HOME_CARDS, type HomeCard } from './links.ts'

const ILLUSTRATIONS: Record<HomeCard['id'], ReactNode> = {
  finder: <MapIllustration />,
  mealcard: <MealcardIllustration />,
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1.5-4 5-5.5 7-5.5S17.5 16 19 20" />
    </svg>
  )
}

export default function HomeApp() {
  const { user, sessionLoading, signingIn, authError, signInWithGoogle, signOut } = useAuth()
  const displayName = user?.user_metadata?.full_name || user?.email || '로그인됨'

  return (
    <div className="home">
      <header className="home-header">
        <a className="home-brand" href="/" aria-label="잇다(EATDA) 첫 화면">
          <span className="home-logo">
            <img src="/eatda-logo.png" alt="" />
          </span>
          <h1>
            잇다<span>(EATDA)</span>
          </h1>
        </a>

        <div className="home-auth">
          {sessionLoading ? (
            <span className="home-auth-note">확인 중…</span>
          ) : user ? (
            <>
              <span className="home-auth-name" title={user.email ?? undefined}>
                <UserIcon />
                {displayName}
              </span>
              <button type="button" className="home-auth-button" onClick={() => void signOut()}>
                로그아웃
              </button>
            </>
          ) : (
            <button type="button" className="home-auth-button" onClick={() => void signInWithGoogle()} disabled={signingIn}>
              <UserIcon />
              {signingIn ? '이동 중…' : 'Google로 로그인'}
            </button>
          )}
        </div>
      </header>

      {authError && (
        <p className="home-auth-error" role="alert">
          {authError}
        </p>
      )}

      <main className="home-main">
        <h2 className="home-sr-only">잇다에서 할 수 있는 일</h2>
        <ul className="home-cards">
          {HOME_CARDS.map(card => (
            <li key={card.id} className={`home-card home-card-${card.id}`}>
              <div className="home-card-art">{ILLUSTRATIONS[card.id]}</div>
              <div className="home-card-body">
                <h3>
                  {card.title.map(line => (
                    <span key={line}>{line}</span>
                  ))}
                </h3>
                <p>{card.description}</p>
                <a className="home-card-link" href={card.href} aria-label={card.linkLabel}>
                  자세히 보기 <span aria-hidden="true">›</span>
                </a>
              </div>
            </li>
          ))}
        </ul>
      </main>

      <footer className="home-footer">
        <strong>잇다</strong> · 강원특별자치도 아동급식카드 가맹점 안내
      </footer>
    </div>
  )
}
