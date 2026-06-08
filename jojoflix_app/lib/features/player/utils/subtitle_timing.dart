String shiftAndScaleWebVtt(
  String content, {
  required int delayMs,
  required double scale,
}) {
  final cuePattern = RegExp(
    r'^((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})(.*)$',
    multiLine: true,
  );
  final normalized = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  final blocks = normalized.split(RegExp(r'\n{2,}'));
  final shiftedBlocks = <String>[];

  for (final block in blocks) {
    if (block.trim().isEmpty) continue;

    final lines = block.split('\n');
    final timingIndex = lines.indexWhere((line) => cuePattern.hasMatch(line));
    if (timingIndex < 0) {
      shiftedBlocks.add(block);
      continue;
    }

    final match = cuePattern.firstMatch(lines[timingIndex]);
    if (match == null) {
      shiftedBlocks.add(block);
      continue;
    }

    final startMs = _parseWebVttTimestamp(match.group(1)!);
    final endMs = _parseWebVttTimestamp(match.group(2)!);
    if (startMs == null || endMs == null) {
      shiftedBlocks.add(block);
      continue;
    }

    var shiftedStart = ((startMs * scale) - delayMs).round();
    var shiftedEnd = ((endMs * scale) - delayMs).round();

    if (shiftedEnd <= 0) continue;
    if (shiftedStart < 0) shiftedStart = 0;
    if (shiftedEnd <= shiftedStart) shiftedEnd = shiftedStart + 250;

    final tail = match.group(3) ?? '';
    lines[timingIndex] =
        '${_formatWebVttTimestamp(shiftedStart)} --> ${_formatWebVttTimestamp(shiftedEnd)}$tail';
    shiftedBlocks.add(lines.join('\n'));
  }

  return shiftedBlocks.join('\n\n');
}

int? _parseWebVttTimestamp(String value) {
  final normalized = value.replaceAll(',', '.').trim();
  final parts = normalized.split(':');
  if (parts.length != 2 && parts.length != 3) return null;

  final secondsPart = parts.last.split('.');
  if (secondsPart.length != 2) return null;

  final hours = parts.length == 3 ? int.tryParse(parts[0]) : 0;
  final minutes = int.tryParse(parts[parts.length - 2]);
  final seconds = int.tryParse(secondsPart[0]);
  final millis = int.tryParse(secondsPart[1]);
  if (hours == null || minutes == null || seconds == null || millis == null) {
    return null;
  }

  return (((hours * 60) + minutes) * 60 + seconds) * 1000 + millis;
}

String _formatWebVttTimestamp(int totalMs) {
  final hours = totalMs ~/ 3600000;
  final minutes = (totalMs % 3600000) ~/ 60000;
  final seconds = (totalMs % 60000) ~/ 1000;
  final millis = totalMs % 1000;
  return '${hours.toString().padLeft(2, '0')}:${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')}.${millis.toString().padLeft(3, '0')}';
}
