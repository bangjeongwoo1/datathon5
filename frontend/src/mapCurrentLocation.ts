export type CurrentLocation = { lat: number; lng: number }

type MapWithLocation = {
  setLevel(level: number): void
  panTo(position: unknown): void
}

type MapsWithLatLng = {
  LatLng: new (lat: number, lng: number) => unknown
}

export function moveMapToCurrentLocation(
  map: MapWithLocation,
  maps: MapsWithLatLng,
  location: CurrentLocation,
) {
  map.setLevel(3)
  map.panTo(new maps.LatLng(location.lat, location.lng))
}
