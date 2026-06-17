import 'dart:async';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';
import '../../../core/native/native_playback_bridge.dart';
import '../../../core/network/api_client.dart';
import '../repository/progress_repository.dart';
import '../repository/transcode_repository.dart';
import '../utils/subtitle_timing.dart';

class VideoPlayerState {
  final bool isLoading;
  final bool isPlaying;
  final Duration position;
  final Duration duration;
  final String? errorCode;
  final bool nearEnd;
  final bool stallRecoveryExhausted;

  const VideoPlayerState({
    this.isLoading = true,
    this.isPlaying = false,
    this.position = Duration.zero,
    this.duration = Duration.zero,
    this.errorCode,
    this.nearEnd = false,
    this.stallRecoveryExhausted = false,
  });

  VideoPlayerState copyWith({
    bool? isLoading,
    bool? isPlaying,
    Duration? position,
    Duration? duration,
    String? errorCode,
    bool? nearEnd,
    bool? stallRecoveryExhausted,
  }) {
    return VideoPlayerState(
      isLoading: isLoading ?? this.isLoading,
      isPlaying: isPlaying ?? this.isPlaying,
      position: position ?? this.position,
      duration: duration ?? this.duration,
      errorCode: errorCode,
      nearEnd: nearEnd ?? this.nearEnd,
      stallRecoveryExhausted:
          stallRecoveryExhausted ?? this.stallRecoveryExhausted,
    );
  }

  double get progress {
    if (duration.inMilliseconds <= 0) return 0.0;
    final raw = position.inMilliseconds / duration.inMilliseconds;
    if (raw.isNaN || raw.isInfinite) return 0.0;
    return raw.clamp(0.0, 1.0);
  }
}

class PlayerTrack {
  final int id;
  final String label;

  const PlayerTrack({required this.id, required this.label});
}

enum _SubtitleSelectionMode { off, external, embedded }

const int _maxSubtitleDelayMs = 60 * 60 * 1000;

final videoPlayerNotifierProvider =
    StateNotifierProvider.autoDispose<VideoPlayerNotifier, VideoPlayerState>(
        (ref) {
  final notifier = VideoPlayerNotifier(ref);
  ref.onDispose(notifier.disposeNotifier);
  return notifier;
});

class VideoPlayerNotifier extends StateNotifier<VideoPlayerState> {
  VideoPlayerNotifier(this.ref) : super(const VideoPlayerState()) {
    _player = Player();
    _videoController = VideoController(_player);
    _bindPlayerStreams();
    unawaited(_configureNativePlaybackBuffering());
  }

  final Ref ref;
  late final Player _player;
  late final VideoController _videoController;

  Timer? _progressTimer;
  Timer? _stallRecoveryTimer;
  Completer<void>? _pendingTrackRefresh;
  StreamSubscription<NativePlaybackCommand>? _nativePlaybackSubscription;

  String? _tmdbId;
  String? _mediaType;
  String? _authToken;
  String? _sourceKey;
  String? _profileId;
  int? _season;
  int? _episode;
  String? _streamId;

  int _subtitleDelayMs = 0;
  double _subtitleScale = 1.0;
  String? _audioLanguageOverride;
  // Source VTT injectee dans le player (OpenSubtitles ou piste integree exportee).
  String? _externalSubtitleOriginalVtt;
  String? _externalSubtitleLabel;
  String? _externalSubtitleLanguage;
  _SubtitleSelectionMode _subtitleSelectionMode = _SubtitleSelectionMode.off;
  PlayerTrack? _selectedEmbeddedSubtitleTrack;
  List<AudioTrack> _audioTrackRefs = const [];
  List<SubtitleTrack> _subtitleTrackRefs = const [];
  Set<Object?> _knownNativeSubtitleTrackIds = <Object?>{};
  int? _pendingStartPosition;
  bool _startPositionApplied = false;
  Duration _stallBufferedPosition = Duration.zero;
  int _stallRecoveryAttempts = 0;
  bool _isRecoveringStall = false;
  int? _videoWidth;
  int? _videoHeight;
  int? _lastReportedPlaybackSecond;
  String? _presentationTitle;
  String? _presentationSubtitle;
  String? _presentationArtworkUrl;
  bool _isApplyingPreferredAudio = false;
  DateTime? _preferredAudioSelectionDeadline;

  final NativePlaybackBridge _nativePlaybackBridge =
      NativePlaybackBridge.instance;

  bool get hasController => true;
  VideoController get videoController => _videoController;
  String? get activeStreamId => _streamId;

  int get subtitleDelayMs => _subtitleDelayMs;
  double get subtitleScale => _subtitleScale;

  Future<void> setPresentationMetadata({
    required String title,
    String? subtitle,
    String? artworkUrl,
  }) async {
    _presentationTitle = title.trim().isEmpty ? 'Jojoflix' : title.trim();
    _presentationSubtitle = subtitle?.trim();
    _presentationArtworkUrl = artworkUrl?.trim();
    await _pushNativePlaybackState(force: true);
  }

  PlayerTrack? get activeAudioTrack {
    _refreshTrackRefs();
    final activeTrack = _player.state.track.audio;
    final index =
        _audioTrackRefs.indexWhere((track) => track.id == activeTrack.id);
    if (index < 0) return null;
    return PlayerTrack(
        id: index, label: _audioTrackLabel(_audioTrackRefs[index], index));
  }

  PlayerTrack? get activeEmbeddedSubtitleTrack {
    final selectedEmbeddedTrack = _selectedEmbeddedSubtitleTrack;
    if (_subtitleSelectionMode == _SubtitleSelectionMode.embedded &&
        selectedEmbeddedTrack != null) {
      return selectedEmbeddedTrack;
    }

    _refreshTrackRefs();
    final activeTrack = _player.state.track.subtitle;
    final index =
        _subtitleTrackRefs.indexWhere((track) => track.id == activeTrack.id);
    if (index < 0) return null;
    return PlayerTrack(
      id: index,
      label: _subtitleTrackLabel(_subtitleTrackRefs[index], index),
    );
  }

  bool get isExternalSubtitleTrackSelected {
    return _subtitleSelectionMode == _SubtitleSelectionMode.external;
  }

  List<PlayerTrack> get subtitleTracks {
    _refreshTrackRefs();
    return List.generate(
      _subtitleTrackRefs.length,
      (index) {
        final track = _subtitleTrackRefs[index];
        return PlayerTrack(id: index, label: _subtitleTrackLabel(track, index));
      },
    );
  }

  Future<void> loadStream({
    required String tmdbId,
    required String mediaType,
    String? profileId,
    int? season,
    int? episode,
    int startPosition = 0,
    String? sourceKey,
  }) async {
    final isSameMediaSelection = _tmdbId == tmdbId &&
        _mediaType == mediaType &&
        _season == season &&
        _episode == episode &&
        _sourceKey == sourceKey;

    _tmdbId = tmdbId;
    _mediaType = mediaType;
    _season = season;
    _episode = episode;
    _sourceKey = sourceKey;
    _streamId = _newStreamId(
      tmdbId: tmdbId,
      mediaType: mediaType,
      season: season,
      episode: episode,
    );
    _externalSubtitleOriginalVtt = null;
    _externalSubtitleLabel = null;
    _externalSubtitleLanguage = null;
    _selectedEmbeddedSubtitleTrack = null;
    _subtitleSelectionMode = _SubtitleSelectionMode.off;

    if (!isSameMediaSelection) {
      _subtitleDelayMs = 0;
      _subtitleScale = 1.0;
      await _applyNativeSubtitleDelay();
    }

    final prefs = ref.read(sharedPreferencesProvider);
    final storedProfileId = prefs.getString('active_profile_id');
    final providedProfileId =
        profileId != null && profileId.isNotEmpty ? profileId : null;
    _profileId = providedProfileId ??
        (storedProfileId != null && storedProfileId.isNotEmpty
            ? storedProfileId
            : null);
    _authToken = prefs.getString('auth_token');

    state =
        const VideoPlayerState(isLoading: true, stallRecoveryExhausted: false);
    _cancelStallRecovery();
    _stallRecoveryAttempts = 0;
    _isRecoveringStall = false;

    final streamPath = _buildStreamPath(
      tmdbId: tmdbId,
      mediaType: mediaType,
      season: season,
      episode: episode,
      profileId: _profileId,
      sourceKey: sourceKey,
      token: _authToken,
      streamId: _streamId,
    );
    await _reopenFromPath(streamPath, resumeAtSeconds: startPosition);
    _startProgressSync();
  }

  Future<void> loadLocalFile(
    String filePath, {
    int startPosition = 0,
  }) async {
    _tmdbId ??= 'offline';
    _mediaType ??= 'offline';
    _sourceKey = null;
    _streamId = null;
    _externalSubtitleOriginalVtt = null;
    _externalSubtitleLabel = null;
    _externalSubtitleLanguage = null;
    _selectedEmbeddedSubtitleTrack = null;
    _subtitleSelectionMode = _SubtitleSelectionMode.off;
    state =
        const VideoPlayerState(isLoading: true, stallRecoveryExhausted: false);
    _cancelStallRecovery();
    _stallRecoveryAttempts = 0;
    _isRecoveringStall = false;
    await _reopenFromPath(Uri.file(filePath).toString(),
        resumeAtSeconds: startPosition);
  }

  Future<void> switchSource(String sourceKey) async {
    final currentPos = state.position.inSeconds;
    _externalSubtitleOriginalVtt = null;
    _externalSubtitleLabel = null;
    _externalSubtitleLanguage = null;

    await loadStream(
      tmdbId: _tmdbId!,
      mediaType: _mediaType!,
      profileId: _profileId,
      season: _season,
      episode: _episode,
      startPosition: currentPos,
      sourceKey: sourceKey,
    );
  }

  Future<void> togglePlayPause() async {
    _player.playOrPause();
  }

  Future<void> seekForward() async {
    await seekTo(state.position + const Duration(seconds: 15));
  }

  Future<void> seekBackward() async {
    await seekTo(state.position - const Duration(seconds: 15));
  }

  Future<void> seekTo(Duration position) async {
    final safePosition = position < Duration.zero ? Duration.zero : position;
    await _player.seek(safePosition);
  }

  Future<void> togglePlayback() async {
    if (_player.state.playing) {
      await _player.pause();
      return;
    }

    await _player.play();
  }

  Future<void> setSpeed(double speed) async {
    await _player.setRate(speed);
  }

  Future<void> skipToSecond(int second) async {
    await seekTo(Duration(seconds: second));
  }

  Future<void> adjustSubtitleDelay(int deltaMs) async {
    _subtitleDelayMs = (_subtitleDelayMs + deltaMs)
        .clamp(-_maxSubtitleDelayMs, _maxSubtitleDelayMs)
        .toInt();
    await _applySubtitleTimingToPlayer();
  }

  Future<void> resetSubtitleDelay() async {
    _subtitleDelayMs = 0;
    await _applySubtitleTimingToPlayer();
  }

  Future<void> adjustSubtitleScale(double delta) async {
    final updated = (_subtitleScale + delta).clamp(0.90, 1.10);
    _subtitleScale = double.parse(updated.toStringAsFixed(4));
    await _applySubtitleTimingToPlayer();
  }

  Future<void> resetSubtitleTiming() async {
    _subtitleDelayMs = 0;
    _subtitleScale = 1.0;
    await _applySubtitleTimingToPlayer();
  }

  // Sets subtitle delay to an absolute value (used to restore saved per-series delay).
  Future<void> setSubtitleDelayMs(int ms) async {
    _subtitleDelayMs =
        ms.clamp(-_maxSubtitleDelayMs, _maxSubtitleDelayMs).toInt();
    await _applySubtitleTimingToPlayer();
  }

  // Returns the raw language code of an audio track by its player index.
  String? getAudioTrackLanguage(int trackId) {
    if (trackId < 0 || trackId >= _audioTrackRefs.length) return null;
    return _audioTrackRefs[trackId].language?.trim().toLowerCase();
  }

  String? getSubtitleTrackLanguage(int trackId) {
    if (trackId < 0 || trackId >= _subtitleTrackRefs.length) return null;
    return _subtitleTrackRefs[trackId].language?.trim().toLowerCase();
  }

  // Overrides the preferred audio language for this session (per-series pref).
  void setAudioLanguagePreference(String? lang) {
    _audioLanguageOverride = lang?.trim().toLowerCase();
  }

  Future<void> loadSubtitle(
    String url, {
    Duration timeout = const Duration(seconds: 45),
  }) async {
    _externalSubtitleLabel = 'OpenSubtitles Pro';
    _externalSubtitleLanguage = '';

    try {
      final vtt = await _fetchExternalVtt(url, timeout: timeout);
      _externalSubtitleOriginalVtt = vtt;
      _subtitleSelectionMode = _SubtitleSelectionMode.external;
      _selectedEmbeddedSubtitleTrack = null;
      await _applyExternalSubtitleTrack();
    } catch (_) {
      rethrow;
    }
  }

  Future<void> loadLocalSubtitleFile(
    String filePath, {
    String? label,
    String? language,
  }) async {
    final content = await File(filePath).readAsString();
    if (content.trim().isEmpty) return;
    _externalSubtitleOriginalVtt = _normalizeExternalVtt(content);
    _externalSubtitleLabel = label ?? 'Sous-titre hors ligne';
    _externalSubtitleLanguage = language ?? '';
    _subtitleSelectionMode = _SubtitleSelectionMode.external;
    _selectedEmbeddedSubtitleTrack = null;
    await _applyExternalSubtitleTrack();
  }

  Future<void> disableSubtitles() async {
    _externalSubtitleOriginalVtt = null;
    _externalSubtitleLabel = null;
    _externalSubtitleLanguage = null;
    _selectedEmbeddedSubtitleTrack = null;
    _subtitleSelectionMode = _SubtitleSelectionMode.off;
    await _player.setSubtitleTrack(SubtitleTrack.no());
  }

  Future<void> setEmbeddedSubtitleTrack(PlayerTrack track) async {
    _refreshTrackRefs();
    if (track.id < 0 || track.id >= _subtitleTrackRefs.length) return;

    final selectedTrack = PlayerTrack(id: track.id, label: track.label);

    if (_isApplePlatform) {
      await _loadEmbeddedSubtitleTrackAsVtt(selectedTrack);
      _subtitleSelectionMode = _SubtitleSelectionMode.embedded;
      _selectedEmbeddedSubtitleTrack = selectedTrack;
      return;
    }

    _externalSubtitleOriginalVtt = null;
    _externalSubtitleLabel = null;
    _externalSubtitleLanguage = null;
    await _player.setSubtitleTrack(_subtitleTrackRefs[track.id]);
    _subtitleSelectionMode = _SubtitleSelectionMode.embedded;
    _selectedEmbeddedSubtitleTrack = selectedTrack;
    await _applyNativeSubtitleDelay();
  }

  Future<List<PlayerTrack>> getAudioTracks() async {
    _refreshTrackRefs();
    return List.generate(
      _audioTrackRefs.length,
      (index) {
        final track = _audioTrackRefs[index];
        return PlayerTrack(id: index, label: _audioTrackLabel(track, index));
      },
    );
  }

  Future<void> setAudioTrack(PlayerTrack track) async {
    _refreshTrackRefs();
    if (track.id < 0 || track.id >= _audioTrackRefs.length) return;
    await _player.setAudioTrack(_audioTrackRefs[track.id]);
  }

  Future<void> _applyExternalSubtitleTrack() async {
    final original = _externalSubtitleOriginalVtt;
    if (original == null || original.trim().isEmpty) return;

    // Shift timestamps directly in the VTT — works reliably on all platforms
    // including macOS where MPV sub-delay may not apply to data-URI tracks.
    // UI convention: positive delay means "advance subtitles" (show them earlier).
    final content = (_subtitleDelayMs != 0 || _subtitleScale != 1.0)
        ? shiftAndScaleWebVtt(original,
            delayMs: _subtitleDelayMs, scale: _subtitleScale)
        : original;

    // Remove previously injected data tracks first so the new one gets
    // auto-selected and old tracks don't accumulate between sync adjustments.
    await _removeInjectedSubtitleTracks();
    await _player.setSubtitleTrack(
      SubtitleTrack.data(
        content,
        title: _externalSubtitleLabel,
        language: _externalSubtitleLanguage,
      ),
    );
    // Reset MPV sub-delay to zero — timing is already baked into VTT timestamps.
    _resetNativeSubtitleDelay();
    _refreshTrackRefs();
  }

  void _resetNativeSubtitleDelay() {
    final platform = _player.platform;
    if (platform == null) return;
    try {
      (platform as dynamic).setProperty('sub-delay', '0.000');
      (platform as dynamic).setProperty('sub-speed', '1.0000');
    } catch (_) {}
  }

  /// Supprime via mpv toutes les pistes sous-titres ajoutées dynamiquement
  /// (sub-add / data tracks) pour éviter leur accumulation entre ajustements.
  /// Best-effort : silencieux si le backend mpv n'est pas disponible.
  Future<void> _removeInjectedSubtitleTracks() async {
    final platform = _player.platform;
    if (platform == null) return;
    try {
      // sub-remove sans argument supprime toutes les pistes externes (sub-add).
      // Les pistes intégrées au container ne sont pas affectées.
      await (platform as dynamic).command(['sub-remove']);
    } catch (_) {
      // sub-remove indisponible sur cette plateforme — on continue.
    }
  }

  Future<void> _loadEmbeddedSubtitleTrackAsVtt(PlayerTrack track) async {
    _refreshTrackRefs();
    final language = track.id >= 0 && track.id < _subtitleTrackRefs.length
        ? _subtitleTrackRefs[track.id].language?.trim() ?? ''
        : '';
    final vtt = await ref
        .read(transcodeRepositoryProvider)
        .getSubtitleTrackVtt(track.id, streamId: _streamId);

    if (vtt.trim().isEmpty) {
      throw StateError('EMPTY_EMBEDDED_SUBTITLE');
    }

    _externalSubtitleOriginalVtt = vtt;
    _externalSubtitleLabel = track.label;
    _externalSubtitleLanguage = language;
    await _applyExternalSubtitleTrack();
  }

  Future<void> _applySubtitleTimingToPlayer() async {
    if (_externalSubtitleOriginalVtt != null) {
      // VTT content available — re-inject with shifted timestamps.
      // Covers both external (OpenSubtitles) and embedded-as-VTT (iOS/macOS).
      // sub-delay does not reliably affect data-URI tracks in MPV.
      await _applyExternalSubtitleTrack();
    } else {
      // Native embedded track: use MPV sub-delay property.
      await _applyNativeSubtitleDelay();
    }
  }

  Future<void> _applyNativeSubtitleDelay({bool includeScale = true}) async {
    final platform = _player.platform;
    if (platform == null) return;
    try {
      // MPV convention is the opposite of the UI: positive sub-delay shows
      // subtitles later. Store one UI-facing value and invert only at output.
      await (platform as dynamic).setProperty(
          'sub-delay', (-_subtitleDelayMs / 1000).toStringAsFixed(3));
      await (platform as dynamic).setProperty('sub-speed',
          (includeScale ? _subtitleScale : 1.0).toStringAsFixed(4));
    } catch (_) {
      // Plateforme sans accès libmpv bas niveau.
    }
  }

  String _normalizeExternalVtt(String raw) {
    var text = raw.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    text = text.replaceAll('\uFEFF', '');

    final headerMatches = RegExp(
      r'^WEBVTT\b',
      multiLine: true,
      caseSensitive: false,
    ).allMatches(text).toList();
    if (headerMatches.length > 1) {
      final secondHeaderIndex = headerMatches[1].start;
      final prelude = text.substring(0, secondHeaderIndex);
      if (RegExp(r'OpenSubtitles v3\+', caseSensitive: false)
              .hasMatch(prelude) ||
          prelude.contains('=>') ||
          prelude.contains('&gt;&gt;OpenSubtitles')) {
        text = text.substring(secondHeaderIndex);
      }
    }

    text = text
        .replaceAll('&gt;', '>')
        .replaceAll('&lt;', '<')
        .replaceAll('&amp;', '&')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'");

    text = text.replaceAllMapped(RegExp(r'&#(\d+);'), (match) {
      final code = int.tryParse(match.group(1)!);
      if (code == null) return match.group(0)!;
      return String.fromCharCode(code);
    });
    text = text.replaceAllMapped(RegExp(r'&#x([0-9a-fA-F]+);'), (match) {
      final code = int.tryParse(match.group(1)!, radix: 16);
      if (code == null) return match.group(0)!;
      return String.fromCharCode(code);
    });

    final trimmed = text.trimLeft();
    if (!trimmed.toUpperCase().startsWith('WEBVTT')) {
      return 'WEBVTT\n\n$trimmed';
    }
    return trimmed;
  }

  void _bindPlayerStreams() {
    _nativePlaybackSubscription = _nativePlaybackBridge.commands.listen(
      (command) async {
        switch (command.action) {
          case 'play':
            await _player.play();
            break;
          case 'pause':
            await _player.pause();
            break;
          case 'toggle':
            await _player.playOrPause();
            break;
          case 'seekBy':
            final delta = command.delta;
            if (delta != null) {
              await seekTo(state.position + delta);
            }
            break;
          case 'seekTo':
            final position = command.position;
            if (position != null) {
              await seekTo(position);
            }
            break;
        }
      },
    );

    _player.stream.playing.listen((playing) {
      if (playing) _cancelStallRecovery(resetAttempts: true);
      state = state.copyWith(isPlaying: playing, isLoading: false);
      unawaited(_pushNativePlaybackState(force: true));
    });

    _player.stream.position.listen((position) {
      final remaining = state.duration - position;
      final nearEnd =
          state.duration > Duration.zero && remaining.inSeconds <= 30;
      state = state.copyWith(position: position, nearEnd: nearEnd);
      final currentSecond = position.inSeconds;
      if (_lastReportedPlaybackSecond != currentSecond) {
        _lastReportedPlaybackSecond = currentSecond;
        unawaited(_pushNativePlaybackState());
      }
    });

    _player.stream.duration.listen((duration) {
      state = state.copyWith(duration: duration);
      _refreshTrackRefs();
      _tryApplyStartPosition();
      unawaited(_pushNativePlaybackState(force: true));
    });

    _player.stream.tracks.listen((tracks) {
      _audioTrackRefs = tracks.audio;
      _subtitleTrackRefs = _filterNativeSubtitleTracks(tracks.subtitle);

      final pending = _pendingTrackRefresh;
      if (pending != null && !pending.isCompleted) {
        pending.complete();
      }

      unawaited(_maybeApplyPreferredFrenchAudioTrack());
    });

    _player.stream.width.listen((width) {
      _videoWidth = width;
      unawaited(_pushNativePlaybackState(force: true));
    });

    _player.stream.height.listen((height) {
      _videoHeight = height;
      unawaited(_pushNativePlaybackState(force: true));
    });

    _player.stream.buffering.listen((buffering) {
      if (buffering) {
        _scheduleStallRecovery();
        return;
      }

      _cancelStallRecovery(resetAttempts: true);
      if (!buffering && state.isLoading) {
        state = state.copyWith(isLoading: false);
      }
      unawaited(_pushNativePlaybackState(force: true));
    });

    _player.stream.error.listen((error) {
      if (error.contains('didn\'t interact with the document first')) {
        state = state.copyWith(isLoading: false, isPlaying: false);
        return;
      }
      // mpv reports "filtered" when all demuxed tracks are excluded by config
      // (e.g. hwdec mismatch, bad track ID from a previous session). Treat this
      // as a hard stream failure so the player_screen source-switch logic kicks in.
      final lower = error.toLowerCase();
      if (!state.stallRecoveryExhausted &&
          (lower.contains('filtered') ||
              lower.contains('no streams') ||
              lower.contains('no video') ||
              lower.contains('no audio'))) {
        state = state.copyWith(isLoading: false, stallRecoveryExhausted: true);
      }
    });
  }

  Future<void> _pushNativePlaybackState({bool force = false}) async {
    if (_tmdbId == null) return;
    if (!force &&
        _lastReportedPlaybackSecond == state.position.inSeconds &&
        state.duration > Duration.zero) {
      // Position déjà remontée pour cette seconde; garder les updates moins
      // verbeuses vers les sessions média système.
    }

    final title = (_presentationTitle?.trim().isNotEmpty ?? false)
        ? _presentationTitle!.trim()
        : 'Jojoflix';
    final subtitle = _presentationSubtitle?.trim();

    await _nativePlaybackBridge.updatePlayback(
      active: true,
      isPlaying: state.isPlaying,
      position: state.position,
      duration: state.duration,
      title: title,
      subtitle: subtitle,
      artworkUrl: _presentationArtworkUrl,
      videoWidth: _videoWidth,
      videoHeight: _videoHeight,
    );
  }

  void _refreshTrackRefs() {
    _audioTrackRefs = _player.state.tracks.audio;
    _subtitleTrackRefs =
        _filterNativeSubtitleTracks(_player.state.tracks.subtitle);
  }

  void _clearCachedTracks() {
    _audioTrackRefs = const [];
    _subtitleTrackRefs = const [];
    _knownNativeSubtitleTrackIds = <Object?>{};
  }

  Future<void> _waitForTrackRefresh() async {
    final pending = _pendingTrackRefresh;
    if (pending == null) return;

    try {
      await pending.future.timeout(const Duration(seconds: 2));
    } catch (_) {
      // Best effort: certaines sources exposent les pistes plus tard.
    } finally {
      if (identical(_pendingTrackRefresh, pending)) {
        _pendingTrackRefresh = null;
      }
    }

    final deadline = DateTime.now().add(const Duration(seconds: 3));
    while (DateTime.now().isBefore(deadline)) {
      _refreshTrackRefs();
      if (_audioTrackRefs.isNotEmpty ||
          _subtitleTrackRefs.isNotEmpty ||
          _player.state.duration > Duration.zero) {
        return;
      }
      await Future.delayed(const Duration(milliseconds: 150));
    }
  }

  List<SubtitleTrack> _filterNativeSubtitleTracks(List<SubtitleTrack> tracks) {
    // Prédicat commun : on n'expose jamais les pistes virtuelles ni les pistes
    // injectées dynamiquement (data/uri) dans la liste "pistes intégrées".
    bool isNative(SubtitleTrack t) =>
        t.id != 'no' && t.id != 'auto' && !t.uri && !t.data;

    final explicitNativeTracks = tracks.where(isNative).toList(growable: false);

    if (explicitNativeTracks.isNotEmpty) {
      _knownNativeSubtitleTrackIds =
          explicitNativeTracks.map((t) => t.id).toSet();
      return explicitNativeTracks;
    }

    // Pas encore de pistes natives connues : retourner uniquement les vraies
    // pistes natives (filtre identique). Ne jamais remonter les data tracks
    // accumulées par les injections de sous-titres externes.
    if (_knownNativeSubtitleTrackIds.isEmpty) {
      return tracks.where(isNative).toList(growable: false);
    }

    // Des pistes natives ont été détectées précédemment : se limiter à celles-ci.
    return tracks
        .where((t) =>
            t.id != 'no' &&
            t.id != 'auto' &&
            _knownNativeSubtitleTrackIds.contains(t.id))
        .toList(growable: false);
  }

  bool get _isApplePlatform {
    return defaultTargetPlatform == TargetPlatform.iOS ||
        defaultTargetPlatform == TargetPlatform.macOS;
  }

  Future<void> _configureNativePlaybackBuffering() async {
    if (!_isApplePlatform) return;
    final platform = _player.platform;
    if (platform == null) return;

    try {
      await (platform as dynamic).setProperty('cache', 'yes');
      await (platform as dynamic).setProperty('cache-secs', '30');
      await (platform as dynamic).setProperty('demuxer-readahead-secs', '30');
      await (platform as dynamic).setProperty('demuxer-max-bytes', '268435456');
      await (platform as dynamic)
          .setProperty('demuxer-max-back-bytes', '67108864');
      await (platform as dynamic).setProperty('network-timeout', '90');
      // Suppress all mpv OSD text rendered onto the video texture — raw mpv
      // error/status messages must never be visible to the user.
      await (platform as dynamic).setProperty('osd-level', '0');
      await (platform as dynamic).setProperty('osd-bar', 'no');
    } catch (_) {
      // Certaines plateformes n'exposent pas ces propriétés mpv.
    }
  }

  void _scheduleStallRecovery() {
    if (!_isApplePlatform) return;
    if (state.isLoading) return;
    if (_tmdbId == null || _mediaType == null) return;
    if (_isRecoveringStall) return;
    if (state.position <= Duration.zero) return;

    _stallRecoveryTimer?.cancel();
    _stallBufferedPosition = state.position;
    _stallRecoveryTimer = Timer(const Duration(seconds: 12), () async {
      if (_isRecoveringStall) return;
      if (!_player.state.buffering) return;

      final stalledFor =
          (state.position - _stallBufferedPosition).inSeconds.abs();
      if (stalledFor > 2) return;

      if (_stallRecoveryAttempts >= 2) {
        state = state.copyWith(stallRecoveryExhausted: true);
        return;
      }
      _stallRecoveryAttempts += 1;
      _isRecoveringStall = true;

      final keepPinnedSource = _stallRecoveryAttempts == 1;
      final resumeAtSeconds = state.position.inSeconds;
      final recoveryPath = _buildStreamPath(
        tmdbId: _tmdbId!,
        mediaType: _mediaType!,
        season: _season,
        episode: _episode,
        profileId: _profileId,
        sourceKey: keepPinnedSource ? _sourceKey : null,
        token: _authToken,
        streamId: _streamId,
      );

      if (!keepPinnedSource) {
        _sourceKey = null;
      }

      state = state.copyWith(isLoading: true);
      try {
        await _reopenFromPath(recoveryPath, resumeAtSeconds: resumeAtSeconds);
      } catch (_) {
        state = state.copyWith(isLoading: false);
      } finally {
        _isRecoveringStall = false;
      }
    });
  }

  void _cancelStallRecovery({bool resetAttempts = false}) {
    _stallRecoveryTimer?.cancel();
    _stallRecoveryTimer = null;
    if (resetAttempts) {
      _stallRecoveryAttempts = 0;
    }
  }

  String _audioTrackLabel(AudioTrack track, int index) {
    final title = track.title?.trim();
    final language = track.language?.trim();
    if (title != null && title.isNotEmpty) return title;
    if (language != null && language.isNotEmpty) {
      final normalized = language.toLowerCase();
      const twoLetter = {
        'fr': 'Francais',
        'en': 'Anglais',
        'es': 'Espagnol',
        'de': 'Allemand',
        'it': 'Italien',
        'pt': 'Portugais',
        'ja': 'Japonais',
        'ko': 'Coreen',
        'zh': 'Chinois',
        'ar': 'Arabe',
        'ru': 'Russe',
        'tr': 'Turc',
      };
      const threeLetter = {
        'fra': 'Francais',
        'fre': 'Francais',
        'eng': 'Anglais',
        'spa': 'Espagnol',
        'deu': 'Allemand',
        'ger': 'Allemand',
        'ita': 'Italien',
        'por': 'Portugais',
        'jpn': 'Japonais',
        'kor': 'Coreen',
        'zho': 'Chinois',
        'chi': 'Chinois',
        'ara': 'Arabe',
        'rus': 'Russe',
        'tur': 'Turc',
      };
      return twoLetter[normalized] ??
          threeLetter[normalized] ??
          normalized.toUpperCase();
    }
    return 'Piste audio ${index + 1}';
  }

  String _subtitleTrackLabel(SubtitleTrack track, int index) {
    final title = track.title?.trim();
    final language = track.language?.trim();
    if (title != null && title.isNotEmpty) return title;
    if (language != null && language.isNotEmpty) return language;
    return 'Sous-titre ${index + 1}';
  }

  Future<void> _tryApplyStartPosition() async {
    if (_startPositionApplied) return;
    final startSeconds = _pendingStartPosition;
    if (startSeconds == null || startSeconds <= 0) {
      _startPositionApplied = true;
      _pendingStartPosition = null;
      return;
    }

    final durationSeconds = _player.state.duration.inSeconds;
    if (durationSeconds <= 0) return;

    final safeStart = startSeconds > durationSeconds
        ? durationSeconds > 10
            ? durationSeconds - 5
            : durationSeconds
        : startSeconds;

    _startPositionApplied = true;
    _pendingStartPosition = null;
    await _player.seek(Duration(seconds: safeStart));
  }

  Future<void> _reopenFromPath(
    String path, {
    int? resumeAtSeconds,
  }) async {
    // Ensure OSD is suppressed before every open — the async init may not have
    // completed yet on the first call, so we re-apply here unconditionally.
    final platform = _player.platform;
    if (platform != null) {
      try {
        await (platform as dynamic).setProperty('osd-level', '0');
        await (platform as dynamic).setProperty('osd-bar', 'no');
      } catch (_) {}
    }

    _pendingStartPosition = (resumeAtSeconds != null && resumeAtSeconds > 0)
        ? resumeAtSeconds
        : null;
    _startPositionApplied = _pendingStartPosition == null;

    final pathUri = Uri.parse(path);
    final apiBaseUrl = ref.read(apiClientProvider).dio.options.baseUrl;
    final streamUrl = pathUri.hasScheme
        ? pathUri.toString()
        : Uri.parse(apiBaseUrl).resolve(path).toString();
    await _player.stop();
    _clearCachedTracks();
    _pendingTrackRefresh = Completer<void>();
    _preferredAudioSelectionDeadline =
        DateTime.now().add(const Duration(seconds: 6));
    await _resetNativeTrackSelectionForNewMedia();
    await _player.open(Media(streamUrl));
    await _waitForTrackRefresh();
    await _applyPreferredFrenchAudioTrackWithRetry();
    _maybeAutoSelectFrenchSubtitle();
    await _restoreSubtitleSelectionAfterOpen();
    _refreshTrackRefs();
    await _tryApplyStartPosition();
  }

  void _maybeAutoSelectFrenchSubtitle() {
    if (_subtitleSelectionMode != _SubtitleSelectionMode.off) return;

    _refreshTrackRefs();
    if (_subtitleTrackRefs.isEmpty) return;

    // Ne pas auto-sélectionner si l'audio est déjà français (contenu VF)
    final activeAudio = _player.state.track.audio;
    final audioLang = activeAudio.language?.trim().toLowerCase() ?? '';
    final audioTitle = activeAudio.title?.trim().toLowerCase() ?? '';
    final isFrenchAudio = audioLang == 'fr' ||
        audioLang == 'fra' ||
        audioLang == 'fre' ||
        RegExp(r'\b(truefrench|vff|vfq|vf|french|français|francais)\b',
                caseSensitive: false)
            .hasMatch('$audioLang $audioTitle');
    if (isFrenchAudio) return;

    // Chercher une piste de sous-titres français intégrée
    final frenchSubRe = RegExp(
      r'\b(french|français|francais|truefrench|vff|vfq|vfq|vostfr|subfrench|fr)\b',
      caseSensitive: false,
    );
    for (int i = 0; i < _subtitleTrackRefs.length; i++) {
      final track = _subtitleTrackRefs[i];
      final lang = track.language?.trim().toLowerCase() ?? '';
      final title = track.title?.trim().toLowerCase() ?? '';
      if (lang == 'fr' ||
          lang == 'fra' ||
          lang == 'fre' ||
          lang.startsWith('fr-') ||
          frenchSubRe.hasMatch(title)) {
        _selectedEmbeddedSubtitleTrack = PlayerTrack(
          id: i,
          label: _subtitleTrackLabel(_subtitleTrackRefs[i], i),
        );
        _subtitleSelectionMode = _SubtitleSelectionMode.embedded;
        return;
      }
    }
  }

  Future<void> _restoreSubtitleSelectionAfterOpen() async {
    switch (_subtitleSelectionMode) {
      case _SubtitleSelectionMode.off:
        await _player.setSubtitleTrack(SubtitleTrack.no());
        await _applyNativeSubtitleDelay();
        return;
      case _SubtitleSelectionMode.external:
        if (_externalSubtitleOriginalVtt == null ||
            _externalSubtitleOriginalVtt!.trim().isEmpty) {
          _subtitleSelectionMode = _SubtitleSelectionMode.off;
          await _player.setSubtitleTrack(SubtitleTrack.no());
          await _applyNativeSubtitleDelay();
          return;
        }
        await _applyExternalSubtitleTrack();
        return;
      case _SubtitleSelectionMode.embedded:
        final selectedTrack = _selectedEmbeddedSubtitleTrack;
        if (selectedTrack == null) {
          _subtitleSelectionMode = _SubtitleSelectionMode.off;
          await _player.setSubtitleTrack(SubtitleTrack.no());
          await _applyNativeSubtitleDelay();
          return;
        }

        if (_isApplePlatform) {
          if (_externalSubtitleOriginalVtt == null ||
              _externalSubtitleOriginalVtt!.trim().isEmpty) {
            await _loadEmbeddedSubtitleTrackAsVtt(selectedTrack);
            return;
          }
          await _applyExternalSubtitleTrack();
          return;
        }

        _refreshTrackRefs();
        if (selectedTrack.id < 0 ||
            selectedTrack.id >= _subtitleTrackRefs.length) {
          _subtitleSelectionMode = _SubtitleSelectionMode.off;
          _selectedEmbeddedSubtitleTrack = null;
          await _player.setSubtitleTrack(SubtitleTrack.no());
          await _applyNativeSubtitleDelay();
          return;
        }

        await _player.setSubtitleTrack(_subtitleTrackRefs[selectedTrack.id]);
        await _applyNativeSubtitleDelay();
        return;
    }
  }

  Future<void> _resetNativeTrackSelectionForNewMedia() async {
    try {
      // media_kit/mpv conserve aid/sid entre deux ouvertures. Si on ne remet
      // pas ces propriétés à zéro, une ancienne piste peut être réappliquée
      // sur un nouveau fichier et pointer vers une autre langue.
      await _player.setAudioTrack(AudioTrack.auto());
    } catch (_) {
      // Best effort: on laisse l'ouverture continuer.
    }

    try {
      await _player.setSubtitleTrack(SubtitleTrack.no());
    } catch (_) {
      // Best effort: on laisse l'ouverture continuer.
    }
  }

  Future<void> _applyPreferredFrenchAudioTrackWithRetry() async {
    for (var attempt = 0; attempt < 5; attempt++) {
      _refreshTrackRefs();
      final preferredTrack = _findPreferredFrenchAudioTrack();
      if (preferredTrack != null) {
        final activeTrack = _player.state.track.audio;
        if (activeTrack.id != preferredTrack.id) {
          try {
            await _player.setAudioTrack(preferredTrack);
          } catch (_) {
            // Best effort: si le player refuse encore la piste, on garde l'auto.
          }
        }
        return;
      }

      if (attempt < 4) {
        await Future.delayed(const Duration(milliseconds: 350));
      }
    }
  }

  Future<void> _maybeApplyPreferredFrenchAudioTrack() async {
    final deadline = _preferredAudioSelectionDeadline;
    if (deadline == null) return;
    if (_isApplyingPreferredAudio) return;

    final now = DateTime.now();
    if (now.isAfter(deadline)) {
      _preferredAudioSelectionDeadline = null;
      return;
    }

    _refreshTrackRefs();
    if (_audioTrackRefs.isEmpty) {
      return;
    }

    final preferredTrack = _findPreferredFrenchAudioTrack();
    if (preferredTrack == null) {
      return;
    }

    final activeTrack = _player.state.track.audio;
    if (activeTrack.id == preferredTrack.id) {
      _preferredAudioSelectionDeadline = null;
      return;
    }

    _isApplyingPreferredAudio = true;
    try {
      await _player.setAudioTrack(preferredTrack);
      _refreshTrackRefs();
      if (_player.state.track.audio.id == preferredTrack.id) {
        _preferredAudioSelectionDeadline = null;
      }
    } catch (_) {
      // Best effort: on réessaiera sur un prochain refresh si on est encore dans la fenêtre.
    } finally {
      _isApplyingPreferredAudio = false;
    }
  }

  AudioTrack? _findPreferredFrenchAudioTrack() {
    if (_audioTrackRefs.isEmpty) return null;

    final ranked = _audioTrackRefs
        .map((track) => MapEntry(track, _preferredAudioTrackScore(track)))
        .where((entry) => entry.value > 0)
        .toList()
      ..sort((a, b) => b.value.compareTo(a.value));

    return ranked.isEmpty ? null : ranked.first.key;
  }

  int _preferredAudioTrackScore(AudioTrack track) {
    final language = track.language?.trim().toLowerCase() ?? '';
    final title = track.title?.trim().toLowerCase() ?? '';
    final combined = '$language $title'.trim();

    // Per-series override beats everything (user explicitly picked this lang).
    final override = _audioLanguageOverride;
    if (override != null && override.isNotEmpty) {
      final langAliases = {
        'fr': ['fr', 'fra', 'fre'],
        'en': ['en', 'eng'],
        'ko': ['ko', 'kor'],
        'ja': ['ja', 'jpn'],
        'es': ['es', 'spa'],
        'de': ['de', 'deu', 'ger'],
        'pt': ['pt', 'por'],
        'it': ['it', 'ita'],
        'zh': ['zh', 'zho', 'chi'],
        'ar': ['ar', 'ara'],
        'ru': ['ru', 'rus'],
        'tr': ['tr', 'tur'],
      };
      final aliases = langAliases[override] ?? [override];
      if (aliases.contains(language)) return 20;
    }

    // French — highest priority
    if (language == 'fr' || language == 'fra' || language == 'fre') {
      return 10;
    }
    if (RegExp(r'\b(truefrench|vff|vfq|french|français|francais)\b',
            caseSensitive: false)
        .hasMatch(combined)) {
      return 9;
    }
    if (RegExp(r'(^|[^a-z])vf([^a-z]|$)', caseSensitive: false)
        .hasMatch(combined)) {
      return 8;
    }

    // Japanese = Korean (anime / K-drama)
    if (language == 'ja' || language == 'jpn') {
      return 5;
    }
    if (language == 'ko' || language == 'kor') {
      return 5;
    }
    if (RegExp(r'\b(japanese|japonais|jpn)\b', caseSensitive: false)
        .hasMatch(combined)) {
      return 4;
    }
    if (RegExp(r'\b(korean|cor[eé]en|kor)\b', caseSensitive: false)
        .hasMatch(combined)) {
      return 4;
    }

    // English — fallback
    if (language == 'en' || language == 'eng') {
      return 2;
    }
    if (RegExp(r'\b(english|anglais|eng)\b', caseSensitive: false)
        .hasMatch(combined)) {
      return 1;
    }

    return 0;
  }

  Future<String> _fetchExternalVtt(
    String url, {
    required Duration timeout,
  }) async {
    final dio = ref.read(apiClientProvider).dio;
    final response = await dio.get<String>(
      url,
      options: Options(
        responseType: ResponseType.plain,
        sendTimeout: const Duration(seconds: 10),
        receiveTimeout: timeout,
      ),
    );
    final vtt = _normalizeExternalVtt(response.data ?? '');
    if (vtt.trim().isEmpty) {
      throw Exception('EMPTY_SUBTITLE');
    }
    if (!RegExp(r'^\s*\uFEFF?\s*WEBVTT', caseSensitive: false).hasMatch(vtt)) {
      throw Exception('INVALID_SUBTITLE_FORMAT');
    }
    return vtt;
  }

  String _buildStreamPath({
    required String tmdbId,
    required String mediaType,
    int? season,
    int? episode,
    String? profileId,
    String? sourceKey,
    String? token,
    String? streamId,
  }) {
    String path;
    if (mediaType == 'tv' && season != null && episode != null) {
      path = '/api/stream/tv/$tmdbId/s/$season/e/$episode';
    } else {
      path = '/api/stream/movie/$tmdbId';
    }

    final queryParams = <String, String>{};
    if (sourceKey != null && sourceKey.isNotEmpty) {
      queryParams['source_key'] = sourceKey;
    }
    if (profileId != null && profileId.isNotEmpty) {
      queryParams['profile_id'] = profileId;
    }
    if (token != null && token.isNotEmpty) {
      queryParams['token'] = token;
    }
    if (streamId != null && streamId.isNotEmpty) {
      queryParams['stream_id'] = streamId;
    }

    if (queryParams.isEmpty) return path;
    return '$path?${Uri(queryParameters: queryParams).query}';
  }

  String _newStreamId({
    required String tmdbId,
    required String mediaType,
    int? season,
    int? episode,
  }) {
    final timestamp = DateTime.now().microsecondsSinceEpoch;
    final media = mediaType.replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '');
    final id = tmdbId.replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '');
    final suffix =
        season != null && episode != null ? '-s$season-e$episode' : '';
    return '$media-$id$suffix-$timestamp';
  }

  void _startProgressSync() {
    _progressTimer?.cancel();
    _progressTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (!state.isPlaying || state.isLoading) return;
      if (_tmdbId == null || _profileId == null) return;
      if (_profileId!.isEmpty) return;

      ref
          .read(progressRepositoryProvider)
          .syncProgress(
            profileId: _profileId!,
            tmdbId: _tmdbId!,
            mediaType: _mediaType ?? 'movie',
            seasonNum: _season,
            episodeNum: _episode,
            currentTime: state.position.inSeconds,
            totalDuration: state.duration.inSeconds,
          )
          .catchError((_) {});
    });
  }

  void disposeNotifier() {
    _progressTimer?.cancel();
    _stallRecoveryTimer?.cancel();
    _nativePlaybackSubscription?.cancel();
    unawaited(_nativePlaybackBridge.deactivatePlayback());
    _player.dispose();
  }
}
// PiP
// Slow sources
