import 'package:flutter_test/flutter_test.dart';
import 'package:jojoflix_app/core/network/api_client.dart';

void main() {
  group('legacy session detection', () {
    test('detects old Adonis access tokens', () {
      expect(isLegacyAuthToken('oat_MTU2.old-token'), isTrue);
      expect(isLegacyAuthToken('SfMB7VdtRDVZkFUHcgqQ0b4YeDxGbCbj'), isFalse);
      expect(isLegacyAuthToken(null), isFalse);
    });

    test('detects old numeric profile ids', () {
      expect(isLegacyProfileId('1'), isTrue);
      expect(isLegacyProfileId('123'), isTrue);
      expect(isLegacyProfileId('m570ayzxd1573tva5hrfm5ends88596k'), isFalse);
      expect(isLegacyProfileId(null), isFalse);
    });
  });
}
