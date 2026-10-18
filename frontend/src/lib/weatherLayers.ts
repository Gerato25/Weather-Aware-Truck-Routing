export type WeatherLayer = 'risk' | 'wind' | 'rain' | 'snow' | 'temp'

export const WEATHER_LAYERS: Record<
  WeatherLayer,
  { key: WeatherLayer; label: string; unit: string; max: number; decimals: number }
> = {
  risk: { key: 'risk', label: 'Risk', unit: '', max: 4, decimals: 0 },
  wind: { key: 'wind', label: 'Wind', unit: 'mph', max: 60, decimals: 0 },
  rain: { key: 'rain', label: 'Rain', unit: 'in/hr', max: 1, decimals: 2 },
  snow: { key: 'snow', label: 'Snow', unit: 'in/hr', max: 3, decimals: 2 },
  temp: { key: 'temp', label: 'Temp', unit: '°F', max: 110, decimals: 0 },
}

export const WEATHER_LAYER_ORDER: WeatherLayer[] = ['risk', 'wind', 'rain', 'snow', 'temp']
