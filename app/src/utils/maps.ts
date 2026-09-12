import { Linking, Platform } from 'react-native';

/**
 * Opens Google Maps centered on the specified coordinates or location name/address.
 * Tries the native Google Maps app first, falling back to the browser.
 */
export const openLocationInGoogleMaps = async (
  location?: string | null,
  latitude?: number | null,
  longitude?: number | null
): Promise<void> => {
  let query = '';
  if (
    latitude !== undefined &&
    latitude !== null &&
    !isNaN(latitude) &&
    longitude !== undefined &&
    longitude !== null &&
    !isNaN(longitude)
  ) {
    query = `${latitude},${longitude}`;
  } else if (location && location.trim()) {
    query = location.trim();
  }

  if (!query) return;

  const encodedQuery = encodeURIComponent(query);
  const googleMapsAppUrl = Platform.select({
    ios: `comgooglemaps://?q=${encodedQuery}`,
    android: `google.navigation:q=${encodedQuery}`,
    default: `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`,
  });
  const googleMapsWebUrl = `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`;

  try {
    const canOpenApp = await Linking.canOpenURL(googleMapsAppUrl);
    if (canOpenApp) {
      await Linking.openURL(googleMapsAppUrl);
      return;
    }
  } catch (err) {
    // If opening app scheme fails or throws, fallback to web
  }

  try {
    await Linking.openURL(googleMapsWebUrl);
  } catch (err) {
    console.error('Failed to open Google Maps URL:', err);
  }
};
