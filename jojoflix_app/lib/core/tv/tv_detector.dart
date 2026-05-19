import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

/// Returns true when the app runs on a TV-like device.
///
/// Heuristic:
/// - Android TV / Fire TV : Android + shortest side ≥ 600 && longest ≥ 1100 logical px
/// - Linux / Windows HTPC : any wide screen ≥ 1100 logical px
bool isTVDevice(BuildContext context) {
  final platform = defaultTargetPlatform;
  final size = MediaQuery.sizeOf(context);
  final shortest = size.shortestSide;
  final longest = size.longestSide;

  if (platform == TargetPlatform.android) {
    return shortest >= 600 && longest >= 1100;
  }
  if (platform == TargetPlatform.linux || platform == TargetPlatform.windows) {
    return longest >= 1100;
  }
  return false;
}
