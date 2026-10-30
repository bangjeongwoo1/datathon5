// 미리보기 전용 진입점: http://localhost:5173/mealcard.html
// 팀 앱(App.tsx)에 연결하기 전에 이 페이지만 따로 띄워 확인할 때 쓴다. 연결할 때는 MealcardApp을 가져다 쓰면 된다.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import MealcardApp from './MealcardApp'

createRoot(document.getElementById('root')!).render(<StrictMode><MealcardApp /></StrictMode>)
