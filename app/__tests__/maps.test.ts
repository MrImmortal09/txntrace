import { openLocationInGoogleMaps } from '../src/utils/maps';
import { Linking, Platform } from 'react-native';

jest.mock('react-native', () => ({
  Linking: {
    canOpenURL: jest.fn(),
    openURL: jest.fn(),
  },
  Platform: {
    select: jest.fn((options: any) => options.ios || options.default),
    OS: 'ios',
  },
}));

describe('openLocationInGoogleMaps', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('does nothing if no location and no coordinates provided', async () => {
    await openLocationInGoogleMaps(undefined, undefined, undefined);
    expect(Linking.canOpenURL).not.toHaveBeenCalled();
    expect(Linking.openURL).not.toHaveBeenCalled();

    await openLocationInGoogleMaps('', null, null);
    expect(Linking.canOpenURL).not.toHaveBeenCalled();
  });

  test('uses coordinates when latitude and longitude are valid numbers', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);

    await openLocationInGoogleMaps('Blue Tokai Cafe', 12.9716, 77.5946);

    expect(Linking.canOpenURL).toHaveBeenCalledWith(
      expect.stringContaining('12.9716%2C77.5946')
    );
    expect(Linking.openURL).toHaveBeenCalledWith(
      expect.stringContaining('12.9716%2C77.5946')
    );
  });

  test('falls back to location text query when coordinates are missing or invalid', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);

    await openLocationInGoogleMaps('Starbucks Indiranagar', NaN, undefined);

    expect(Linking.canOpenURL).toHaveBeenCalledWith(
      expect.stringContaining('Starbucks%20Indiranagar')
    );
  });

  test('falls back to google maps web search if app URL cannot be opened', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);

    await openLocationInGoogleMaps('Third Wave Coffee');

    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://www.google.com/maps/search/?api=1&query=Third%20Wave%20Coffee'
    );
  });

  test('uses geo URI on android platform', async () => {
    (Platform.select as jest.Mock).mockImplementationOnce((options: any) => options.android || options.default);
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);

    await openLocationInGoogleMaps('Indiranagar 100ft Road');

    expect(Linking.canOpenURL).toHaveBeenCalledWith('geo:0,0?q=Indiranagar%20100ft%20Road');
    expect(Linking.openURL).toHaveBeenCalledWith('geo:0,0?q=Indiranagar%20100ft%20Road');
  });
});
