// 첫 화면의 카드 두 장. 어디로 이어지는지와 문구를 한곳에 모아 둔다.
// href 는 frontend/ 폴더에 있는 HTML 페이지(vite.config.ts 의 input)여야 한다. (tests/homeLinks.test.ts 가 확인한다.)

export type HomeCard = {
  id: 'finder' | 'mealcard'
  title: string[] // 줄바꿈 위치를 정해 두려고 줄 단위로 나눈다.
  description: string // 띄어쓰기 단위로 화면 너비에 맞춰 줄바꿈된다.
  href: string
  linkLabel: string // 스크린리더용: "자세히 보기"만으로는 어느 카드인지 알 수 없다.
}

export const HOME_CARDS: HomeCard[] = [
  {
    id: 'finder',
    title: ['내 주변', '가맹점 찾아보기'],
    description: '아동급식카드를 쓸 수 있는 식당을 지도와 목록에서 찾아볼 수 있어요.',
    href: '/finder.html',
    linkLabel: '가맹점 지도 자세히 보기',
  },
  {
    id: 'mealcard',
    title: ['가맹 권유', '지도 둘러보기'],
    description: '학교 주변에서 아직 가맹하지 않은 식당을 찾아 가맹을 권유해 볼 수 있어요.',
    href: '/mealcard.html',
    linkLabel: '가맹 권유 지도 자세히 보기',
  },
]
