import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Supabase 환경변수가 설정되지 않았습니다. frontend/.env에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY를 추가해 주세요.'
  )
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '')
