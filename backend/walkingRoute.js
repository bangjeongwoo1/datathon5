export function validCoordinates(lat, lng) {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180
  );
}


export async function getWalkingRoute(lat, lng, store) {
  try {
    const response = await fetch(
      'https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1',
      {
        method: 'POST',
        headers: {
          appKey: process.env.TMAP_APP_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          startX: lng,
          startY: lat,
          endX: store.coordinates.lng,
          endY: store.coordinates.lat,
          startName: encodeURIComponent('현재 위치'),
          endName: encodeURIComponent(store.name),
          reqCoordType: 'WGS84GEO',
          resCoordType: 'WGS84GEO',
          searchOption: '10',
        }),
        signal: AbortSignal.timeout(12000),
      }
    );

    if (!response.ok) {
      console.error('TMAP 응답 상태:', response.status);
      return null;
    }

    const data = await response.json();
    if (!Array.isArray(data.features)) return null;

    // 보행자 경로의 출발 지점에 총 이동거리가 들어 있음
    const startPoint = data.features?.find(
      f => f?.properties?.pointType === 'SP'
    );

    const meters = startPoint?.properties?.totalDistance;

    if (!Number.isFinite(meters) || meters < 0) {
      return null;
    }

    const segments = data.features.filter(feature =>
      feature?.geometry?.type === 'LineString' &&
      Array.isArray(feature.geometry.coordinates) &&
      feature.geometry.coordinates.length >= 2 &&
      feature.geometry.coordinates.every(point => Array.isArray(point) && point.length >= 2 && validCoordinates(point[1], point[0])) &&
      Number.isFinite(feature.properties?.distance) &&
      feature.properties.distance >= 0
    ).map(feature => ({
      path: feature.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      meters: feature.properties.distance,
    }));
    const steps = data.features.filter(feature =>
      feature?.geometry?.type === 'Point' &&
      !['SP', 'EP'].includes(feature.properties?.pointType) &&
      feature.properties?.turnType >= 12 &&
      feature.properties?.turnType <= 130 &&
      typeof feature.properties?.description === 'string' &&
      Array.isArray(feature.geometry.coordinates) &&
      validCoordinates(feature.geometry.coordinates[1], feature.geometry.coordinates[0])
    ).map(feature => ({
      point: { lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0] },
      instruction: feature.properties.description,
    }));
    return {
      segments,
      steps,
      id: store.id,
      name: store.name,
      address: store.address,
      meters: Math.round(meters),
    };
  } catch (error) {
    console.error('Walking route request failed');
    return null;
  }
}


export function registerWalkingRoute(app) {
app.post('/api/walking-route', async (req, res) => {
  if (!process.env.TMAP_APP_KEY) {
    return res.status(503).json({ error: 'TMAP 키가 설정되지 않았습니다.' });
  }
  const { lat, lng, store } = req.body ?? {};
  if (!validCoordinates(lat, lng) || !store ||
      typeof store.name !== 'string' || !store.name.trim() || store.name.length > 200 ||
      !validCoordinates(store.coordinates?.lat, store.coordinates?.lng)) {
    return res.status(400).json({ error: '출발지 또는 목적지 좌표를 확인해 주세요.' });
  }
  const route = await getWalkingRoute(lat, lng, store);
  if (!route?.segments.length) {
    return res.status(502).json({ error: '도보 경로를 확인하지 못했습니다.' });
  }
  return res.json({ meters: route.meters, segments: route.segments, steps: route.steps });
});
}
