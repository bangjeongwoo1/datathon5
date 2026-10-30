export type Merchant = {
 id:number; name:string; category:string; address:string; phone:string;
 open:boolean; delivery:boolean; menu:string[]; hours:string; distance:number;
 /** UI demonstration coordinates; not a verified business location. */
 coordinates?:{lat:number;lng:number}
}
export const merchants: Merchant[] = [
 {id:1,name:'김밥천국 춘천명동점',category:'일반음식점',address:'강원특별자치도 춘천시 중앙로 67',phone:'033-000-0101',open:true,delivery:true,menu:['야채김밥 3,500원','돈가스 8,000원'],hours:'09:00 – 21:00',distance:240,coordinates:{lat:37.8793,lng:127.7275}},
 {id:2,name:'본죽 춘천시청점',category:'일반음식점',address:'강원특별자치도 춘천시 시청길 11',phone:'033-000-0102',open:true,delivery:false,menu:['야채죽 9,000원','소고기죽 10,000원'],hours:'09:30 – 20:30',distance:180,coordinates:{lat:37.8811,lng:127.7306}},
 {id:3,name:'CU 춘천명동거리점',category:'편의점',address:'강원특별자치도 춘천시 중앙로 59',phone:'033-000-0103',open:true,delivery:false,menu:['도시락','샌드위치'],hours:'24시간',distance:320,coordinates:{lat:37.8799,lng:127.7271}},
 {id:4,name:'파리바게뜨 춘천중앙점',category:'베이커리/간식',address:'강원특별자치도 춘천시 중앙로 82',phone:'033-000-0104',open:true,delivery:true,menu:['샌드위치','우유와 빵'],hours:'07:00 – 22:00',distance:460,coordinates:{lat:37.8784,lng:127.7268}},
 {id:5,name:'명동 한끼식당',category:'일반음식점',address:'강원특별자치도 춘천시 명동길 18',phone:'033-000-0105',open:false,delivery:false,menu:['제육덮밥 8,000원','비빔밥 7,500원'],hours:'11:00 – 19:00',distance:390,coordinates:{lat:37.8787,lng:127.7281}},
 {id:6,name:'GS25 춘천시청점',category:'편의점',address:'강원특별자치도 춘천시 시청길 5',phone:'033-000-0106',open:true,delivery:false,menu:['도시락','주먹밥'],hours:'24시간',distance:120,coordinates:{lat:37.8815,lng:127.7297}},
 {id:7,name:'중앙 든든국밥',category:'일반음식점',address:'강원특별자치도 춘천시 중앙로 74',phone:'033-000-0107',open:true,delivery:true,menu:['돼지국밥 8,500원','순두부찌개 8,000원'],hours:'08:00 – 21:00',distance:350,coordinates:{lat:37.879,lng:127.7269}},
 {id:8,name:'시청 소담분식',category:'일반음식점',address:'강원특별자치도 춘천시 시청길 17',phone:'033-000-0108',open:true,delivery:false,menu:['떡볶이 4,000원','우동 6,000원'],hours:'10:00 – 20:00',distance:220,coordinates:{lat:37.8814,lng:127.7311}},
 {id:9,name:'명동 온기덮밥',category:'일반음식점',address:'강원특별자치도 춘천시 명동길 9',phone:'033-000-0109',open:true,delivery:true,menu:['닭고기덮밥 7,500원','계란덮밥 6,500원'],hours:'11:00 – 20:30',distance:410,coordinates:{lat:37.8786,lng:127.7286}},
 {id:10,name:'봉의동 한상',category:'일반음식점',address:'강원특별자치도 춘천시 봉의산길 8',phone:'033-000-0110',open:false,delivery:false,menu:['된장찌개 8,000원','생선구이정식 9,000원'],hours:'11:00 – 19:30',distance:650,coordinates:{lat:37.8862,lng:127.7316}},
 {id:11,name:'요선 착한백반',category:'일반음식점',address:'강원특별자치도 춘천시 서부대성로 34',phone:'033-000-0111',open:true,delivery:false,menu:['오늘의 백반 7,000원','오므라이스 7,500원'],hours:'10:30 – 20:00',distance:760,coordinates:{lat:37.8841,lng:127.7258}},
 {id:12,name:'춘천 소양국수',category:'일반음식점',address:'강원특별자치도 춘천시 소양로 118',phone:'033-000-0112',open:true,delivery:true,menu:['잔치국수 6,000원','비빔국수 6,500원'],hours:'10:00 – 19:00',distance:980,coordinates:{lat:37.889,lng:127.7241}},
 {id:13,name:'효자 봄날도시락',category:'일반음식점',address:'강원특별자치도 춘천시 효자로 104',phone:'033-000-0113',open:true,delivery:true,menu:['불고기도시락 7,500원','두부도시락 6,500원'],hours:'09:00 – 20:00',distance:1300,coordinates:{lat:37.8715,lng:127.7366}},
 {id:14,name:'석사 한끼정식',category:'일반음식점',address:'강원특별자치도 춘천시 퇴계로 203',phone:'033-000-0114',open:false,delivery:true,menu:['제육정식 8,000원','카레라이스 7,000원'],hours:'11:00 – 21:00',distance:3100,coordinates:{lat:37.8566,lng:127.7454}},
 {id:15,name:'후평 오븐빵집',category:'베이커리/간식',address:'강원특별자치도 춘천시 후석로 326',phone:'033-000-0115',open:true,delivery:false,menu:['에그샌드위치 4,500원','모닝빵과 우유 4,000원'],hours:'07:30 – 21:00',distance:2200,coordinates:{lat:37.8831,lng:127.7528}},
 {id:16,name:'CU 춘천소양로점',category:'편의점',address:'강원특별자치도 춘천시 소양로 106',phone:'033-000-0116',open:true,delivery:false,menu:['도시락','참치주먹밥'],hours:'24시간',distance:900,coordinates:{lat:37.8881,lng:127.7249}},
]
export type Filters = { query:string; category:string; open:boolean; delivery:boolean; distance:boolean }
export function filterMerchants(items:Merchant[], f:Filters) {
 const q=f.query.trim().toLocaleLowerCase()
 const result=items.filter(s=>(f.category==='전체'||s.category===f.category)&&(!f.open||s.open)&&(!f.delivery||s.delivery)&&`${s.name} ${s.address} ${s.menu.join(' ')}`.toLocaleLowerCase().includes(q))
 return f.distance?result.sort((a,b)=>a.distance-b.distance):result
}
