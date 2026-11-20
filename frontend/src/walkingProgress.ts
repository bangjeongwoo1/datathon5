export type Point = { lat: number; lng: number }
export type WalkingRoute = {
  meters: number
  segments: { path: Point[]; meters: number }[]
  steps: { point: Point; instruction: string }[]
}

export function distanceBetween(a: Point, b: Point) {
  const radians = Math.PI / 180
  return 111195 * Math.hypot(b.lat - a.lat, (b.lng - a.lng) * Math.cos((a.lat + b.lat) / 2 * radians))
}

export function projectOntoRoute(route: WalkingRoute, point: Point) {
  let closest = { offset: 0, gap: Infinity }
  let travelled = 0
  for (const segment of route.segments) {
    const lengths = segment.path.slice(1).map((end, index) => distanceBetween(segment.path[index], end))
    const total = lengths.reduce((sum, length) => sum + length, 0)
    let along = 0
    for (const [index, length] of lengths.entries()) {
      if (!length) continue
      const start = segment.path[index]
      const end = segment.path[index + 1]
      const scale = Math.cos(start.lat * Math.PI / 180)
      const x = (end.lng - start.lng) * scale
      const y = end.lat - start.lat
      const dot = (point.lng - start.lng) * scale * x + (point.lat - start.lat) * y
      const fraction = Math.max(0, Math.min(1, dot / (x * x + y * y)))
      const gap = distanceBetween(point, {
        lat: start.lat + fraction * (end.lat - start.lat),
        lng: start.lng + fraction * (end.lng - start.lng),
      })
      if (gap < closest.gap) {
        closest = { gap, offset: travelled + (along + fraction * length) / total * segment.meters }
      }
      along += length
    }
    travelled += segment.meters
  }
  return closest
}
