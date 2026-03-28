import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

class NativePlaybackCommand {
  final String action;
  final Duration? delta;
  final Duration? position;

  const NativePlaybackCommand({
    required this.action,
    this.delta,
    this.position,
  });
}

class NativePlaybackBridge {
  NativePlaybackBridge._() {
    if (_isSupportedPlatform) {
      _channel.setMethodCallHandler(_handleMethodCall);
    }
  }

  static const String _channelName = 'jojoflix/native_playback';
  static const MethodChannel _channel = MethodChannel(_channelName);

  static final NativePlaybackBridge instance = NativePlaybackBridge._();

  final StreamController<NativePlaybackCommand> _commandsController =
      StreamController<NativePlaybackCommand>.broadcast();
  final ValueNotifier<bool> pictureInPictureNotifier =
      ValueNotifier<bool>(false);

  Stream<NativePlaybackCommand> get commands => _commandsController.stream;

  bool get _isSupportedPlatform {
    if (kIsWeb) return false;
    return defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS;
  }

  Future<void> updatePlayback({
    required bool active,
    required bool isPlaying,
    required Duration position,
    required Duration duration,
    required String title,
    String? subtitle,
    String? artworkUrl,
    int? videoWidth,
    int? videoHeight,
  }) async {
    if (!_isSupportedPlatform) return;

    final args = <String, dynamic>{
      'active': active,
      'isPlaying': isPlaying,
      'positionMs': position.inMilliseconds,
      'durationMs': duration.inMilliseconds,
      'title': title,
      'subtitle': subtitle,
      'artworkUrl': artworkUrl,
      'videoWidth': videoWidth,
      'videoHeight': videoHeight,
    };

    await _invokeVoid('updatePlayback', args);
  }

  Future<void> deactivatePlayback() async {
    if (!_isSupportedPlatform) return;
    pictureInPictureNotifier.value = false;
    await _invokeVoid('deactivatePlayback');
  }

  Future<void> setPictureInPictureEnabled(bool enabled) async {
    if (!_isSupportedPlatform ||
        defaultTargetPlatform != TargetPlatform.android) {
      return;
    }
    await _invokeVoid('setPictureInPictureEnabled', {'enabled': enabled});
  }

  Future<void> enterPictureInPicture() async {
    if (!_isSupportedPlatform ||
        defaultTargetPlatform != TargetPlatform.android) {
      return;
    }
    await _invokeVoid('enterPictureInPicture');
  }

  Future<void> _invokeVoid(String method, [Object? arguments]) async {
    try {
      await _channel.invokeMethod<void>(method, arguments);
    } on MissingPluginException {
      // La plateforme courante n'expose pas ce bridge natif.
    } on PlatformException {
      // Best effort: ne pas interrompre la lecture native si la couche système échoue.
    }
  }

  Future<void> _handleMethodCall(MethodCall call) async {
    switch (call.method) {
      case 'command':
        final raw = call.arguments;
        if (raw is! Map) return;
        final action = (raw['action'] as String?)?.trim();
        if (action == null || action.isEmpty) return;
        final deltaMs = (raw['deltaMs'] as num?)?.toInt();
        final positionMs = (raw['positionMs'] as num?)?.toInt();
        _commandsController.add(
          NativePlaybackCommand(
            action: action,
            delta: deltaMs == null ? null : Duration(milliseconds: deltaMs),
            position:
                positionMs == null ? null : Duration(milliseconds: positionMs),
          ),
        );
        return;
      case 'pictureInPictureChanged':
        final raw = call.arguments;
        if (raw is Map) {
          pictureInPictureNotifier.value = raw['enabled'] == true;
        }
        return;
      default:
        return;
    }
  }
}
// Android PiP support, native media controls, improved track matching
// Android
// iOS
