import 'package:flutter_test/flutter_test.dart';
import 'package:jojoflix_app/features/player/utils/subtitle_timing.dart';

void main() {
  group('shiftAndScaleWebVtt', () {
    test('drops cues that become fully negative with large subtitle advance',
        () {
      const source = '''
WEBVTT

00:00:12.550 --> 00:00:15.930
First cue before the offset

00:01:09.640 --> 00:01:12.310
Second cue also before the offset

00:01:19.500 --> 00:01:23.000
Cue crossing zero

00:01:25.190 --> 00:01:26.920
Cue after the offset
''';

      final shifted = shiftAndScaleWebVtt(
        source,
        delayMs: 80000,
        scale: 1,
      );

      expect(shifted, isNot(contains('First cue before the offset')));
      expect(shifted, isNot(contains('Second cue also before the offset')));
      expect(shifted, contains('00:00:00.000 --> 00:00:03.000'));
      expect(shifted, contains('Cue crossing zero'));
      expect(shifted, contains('00:00:05.190 --> 00:00:06.920'));
      expect(shifted, contains('Cue after the offset'));
      expect(
        RegExp(r'00:00:00\.000 --> 00:00:00\.250').allMatches(shifted).length,
        0,
      );
    });

    test('negative offset delays subtitles without dropping early cues', () {
      const source = '''
WEBVTT

00:00:12.550 --> 00:00:15.930
First cue
''';

      final shifted = shiftAndScaleWebVtt(
        source,
        delayMs: -10000,
        scale: 1,
      );

      expect(shifted, contains('00:00:22.550 --> 00:00:25.930'));
      expect(shifted, contains('First cue'));
    });

    test('large cumulative advances keep moving beyond one minute', () {
      const source = '''
WEBVTT

00:01:25.000 --> 00:01:28.000
Cue after eighty seconds
''';

      final plus60 = shiftAndScaleWebVtt(source, delayMs: 60000, scale: 1);
      final plus70 = shiftAndScaleWebVtt(source, delayMs: 70000, scale: 1);
      final plus80 = shiftAndScaleWebVtt(source, delayMs: 80000, scale: 1);

      expect(plus60, contains('00:00:25.000 --> 00:00:28.000'));
      expect(plus70, contains('00:00:15.000 --> 00:00:18.000'));
      expect(plus80, contains('00:00:05.000 --> 00:00:08.000'));
    });
  });
}
