import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:media_kit_video/media_kit_video.dart';
import '../../../core/native/native_playback_bridge.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widget/jojoflix_loader.dart';
import '../../../core/network/api_client.dart';
import '../provider/video_player_provider.dart';
import '../repository/source_repository.dart';
import '../repository/subtitle_repository.dart';
import '../repository/transcode_repository.dart';

class PlayerScreen extends ConsumerStatefulWidget {
  final String tmdbId;
  final String mediaType;
  final String profileId;
  final int? season;
  final int? episode;
  final int startPosition;
  final String? title;
  final String? subtitle;
  final String? artworkUrl;
  final String? localVideoPath;
  final List<Map<String, dynamic>> localSubtitles;

  const PlayerScreen({
    super.key,
    required this.tmdbId,
    required this.mediaType,
    required this.profileId,
    this.season,
    this.episode,
    this.startPosition = 0,
    this.title,
    this.subtitle,
    this.artworkUrl,
    this.localVideoPath,
    this.localSubtitles = const [],
  });

  @override
  ConsumerState<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends ConsumerState<PlayerScreen> {
  final NativePlaybackBridge _nativePlaybackBridge =
      NativePlaybackBridge.instance;

  bool _isBootstrapping = true;
  bool _slowProvidersLoaded = false;
  bool _isLoadingSources = false;
  bool _isLoadingSubtitles = false;
  bool _isSwitchingSource = false;
  bool _isApplyingTrackChange = false;
  bool _isInPictureInPicture = false;
  String? _fatalError;

  List<TorrentSource> _sources = const [];
  List<SubtitleEntry> _openSubtitles = const [];
  List<MediaMarker> _markers = const [];

  String? _activeSourceKey;
  final Set<String> _exhaustedSourceKeys = {};
  // Clé utilisée dans le sélecteur de sous-titres pour afficher la sélection active.
  String _subtitleSelectionKey = 'off';

  static const int _autoNextDelaySeconds = 8;
  Timer? _autoNextTimer;
  int _autoNextRemainingSeconds = _autoNextDelaySeconds;
  bool _autoNextCancelled = false;
  bool _skipIntroHandled = false;

  @override
  void initState() {
    super.initState();
    _isInPictureInPicture =
        _nativePlaybackBridge.pictureInPictureNotifier.value;
    _nativePlaybackBridge.pictureInPictureNotifier
        .addListener(_handlePictureInPictureChanged);
    unawaited(_nativePlaybackBridge.setPictureInPictureEnabled(true));
    WidgetsBinding.instance.addPostFrameCallback((_) => _bootstrap());
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncNativeMetadata());
  }

  @override
  void dispose() {
    _nativePlaybackBridge.pictureInPictureNotifier
        .removeListener(_handlePictureInPictureChanged);
    unawaited(_nativePlaybackBridge.setPictureInPictureEnabled(false));
    _stopAutoNextTimer(resetCountdown: false, resetCancellation: false);
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant PlayerScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final metadataChanged = oldWidget.title != widget.title ||
        oldWidget.subtitle != widget.subtitle ||
        oldWidget.artworkUrl != widget.artworkUrl;
    final shouldReload = oldWidget.tmdbId != widget.tmdbId ||
        oldWidget.mediaType != widget.mediaType ||
        oldWidget.profileId != widget.profileId ||
        oldWidget.season != widget.season ||
        oldWidget.episode != widget.episode ||
        oldWidget.startPosition != widget.startPosition;

    if (!shouldReload) {
      if (metadataChanged) {
        WidgetsBinding.instance
            .addPostFrameCallback((_) => _syncNativeMetadata());
      }
      return;
    }

    if (mounted) {
      setState(() {
        _sources = const [];
        _openSubtitles = const [];
        _markers = const [];
        _activeSourceKey = null;
        _fatalError = null;
        _subtitleSelectionKey = 'off';
        _skipIntroHandled = false;
        _exhaustedSourceKeys.clear();
      });
    }
    _stopAutoNextTimer(resetCountdown: true, resetCancellation: true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      unawaited(_bootstrap());
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncNativeMetadata());
  }

  void _handlePictureInPictureChanged() {
    if (!mounted) return;
    setState(() {
      _isInPictureInPicture =
          _nativePlaybackBridge.pictureInPictureNotifier.value;
    });
  }

  void _syncNativeMetadata() {
    final notifier = ref.read(videoPlayerNotifierProvider.notifier);
    final fallbackTitle =
        widget.mediaType == 'tv' ? 'Lecture série' : 'Lecture film';
    final title = (widget.title?.trim().isNotEmpty ?? false)
        ? widget.title!.trim()
        : fallbackTitle;
    final subtitle = (widget.subtitle?.trim().isNotEmpty ?? false)
        ? widget.subtitle!.trim()
        : (widget.mediaType == 'tv' &&
                widget.season != null &&
                widget.episode != null)
            ? 'S${widget.season} E${widget.episode}'
            : null;

    unawaited(notifier.setPresentationMetadata(
      title: title,
      subtitle: subtitle,
      artworkUrl: widget.artworkUrl,
    ));
  }

  Future<void> _bootstrap() async {
    if (mounted) {
      setState(() {
        _isBootstrapping = true;
        _fatalError = null;
        _skipIntroHandled = false;
      });
    }
    _stopAutoNextTimer(resetCountdown: true, resetCancellation: true);

    final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
    try {
      final localVideoPath = widget.localVideoPath;
      if (localVideoPath != null && localVideoPath.trim().isNotEmpty) {
        await playerNotifier.loadLocalFile(
          localVideoPath.trim(),
          startPosition: widget.startPosition,
        );
        await _applyBestLocalSubtitle();
        return;
      }

      await _restorePreferredSource();

      // Si on a une source préférée sauvegardée, la sonder avant de l'utiliser.
      // Un lien RD expiré ou une source morte est détecté ici, avant que le
      // player essaie de la lire et reste en chargement indéfini.
      if (_activeSourceKey != null && _activeSourceKey!.isNotEmpty) {
        final probe = await _probeSourceAvailability(
          _activeSourceKey!,
          timeout: const Duration(seconds: 4),
        );
        if (!probe.ok) {
          _exhaustedSourceKeys.add(_activeSourceKey!);
          _activeSourceKey = null;
        } else if (probe.selectedSourceKey != null &&
            probe.selectedSourceKey != _activeSourceKey) {
          _activeSourceKey = probe.selectedSourceKey;
        }
      }

      var streamStarted = false;
      try {
        await playerNotifier.loadStream(
          tmdbId: widget.tmdbId,
          mediaType: widget.mediaType,
          profileId: widget.profileId,
          season: widget.season,
          episode: widget.episode,
          startPosition: widget.startPosition,
          sourceKey: _activeSourceKey,
        );
        streamStarted = true;
      } catch (_) {
        streamStarted = false;
      }

      if (!streamStarted) {
        await _loadSources(
            showErrorSnackBar: false, includeSlowProviders: false);
        if (_sources.isEmpty) {
          if (!mounted) return;
          setState(() {
            _fatalError =
                'Aucune source disponible pour ce contenu. Essaie un autre épisode/source.';
          });
          return;
        }
        final selectedSourceKey =
            await _selectBestPlayableSource(preferredKey: _activeSourceKey);
        if (!mounted) return;
        if (selectedSourceKey != null &&
            selectedSourceKey != _activeSourceKey) {
          setState(() => _activeSourceKey = selectedSourceKey);
        }

        final persistedKey = await _startNativePlayback(
          playerNotifier,
          sourceKey: selectedSourceKey ?? _activeSourceKey,
        );
        if (persistedKey != null && persistedKey.isNotEmpty) {
          await _persistPreferredSourceKey(persistedKey);
        }
      } else {
        // Don't unawaited here — we need sources populated before subtitle
        // auto-apply so _subtitleReleaseMatchScore() can match against them.
        await _loadSources(
            showErrorSnackBar: false, includeSlowProviders: false);
      }

      unawaited(_prewarmNextEpisode(preferredSourceKey: _activeSourceKey));
      await _restoreSeriesPreferences();
      await _loadMarkers();
      await _loadOpenSubtitles(showErrorSnackBar: false);
      _syncTrackSelections();
      unawaited(_maybeAutoApplyExternalFrenchSubtitle());
    } catch (_) {
      if (!mounted) return;
      setState(() => _fatalError = 'Impossible de charger le lecteur.');
    } finally {
      if (mounted) setState(() => _isBootstrapping = false);
    }
  }

  Future<void> _applyBestLocalSubtitle() async {
    if (widget.localSubtitles.isEmpty) {
      return;
    }
    final sorted = [...widget.localSubtitles]..sort((a, b) {
        int rank(Map<String, dynamic> item) {
          final language = (item['language'] as String? ?? '').toLowerCase();
          if (language == 'fr' ||
              language.startsWith('fr-') ||
              language == 'french') {
            return 0;
          }
          if (language == 'en' ||
              language.startsWith('en-') ||
              language == 'english') {
            return 1;
          }
          return 2;
        }

        return rank(a).compareTo(rank(b));
      });
    final path = sorted.first['path'] as String?;
    if (path == null || path.isEmpty) return;
    try {
      await ref
          .read(videoPlayerNotifierProvider.notifier)
          .loadLocalSubtitleFile(
            path,
            label: sorted.first['displayName'] as String?,
            language: sorted.first['language'] as String?,
          );
      if (mounted) {
        setState(() {
          _subtitleSelectionKey = 'local:${sorted.first['language'] ?? path}';
        });
      }
    } catch (_) {}
  }

  Future<void> _loadSources({
    bool showErrorSnackBar = true,
    bool includeSlowProviders = false,
  }) async {
    if (mounted) setState(() => _isLoadingSources = true);

    try {
      final repo = ref.read(sourceRepositoryProvider);
      final sources = widget.mediaType == 'tv'
          ? await repo.getTvSources(
              widget.tmdbId,
              widget.season ?? 1,
              widget.episode ?? 1,
              includeSlowProviders: includeSlowProviders,
            )
          : await repo.getMovieSources(
              widget.tmdbId,
              includeSlowProviders: includeSlowProviders,
            );

      if (!mounted) return;
      setState(() {
        _sources = sources;
        if (includeSlowProviders) _slowProvidersLoaded = true;
        final hasCurrent = _activeSourceKey != null &&
            sources.any((s) => s.key == _activeSourceKey);
        if (!hasCurrent) {
          _activeSourceKey = sources.isNotEmpty ? sources.first.key : null;
        }
      });
    } catch (_) {
      if (!mounted || !showErrorSnackBar) return;
      _showErrorSnackBar('Impossible de charger les sources.');
    } finally {
      if (mounted) setState(() => _isLoadingSources = false);
    }
  }

  Future<void> _loadOpenSubtitles({bool showErrorSnackBar = true}) async {
    if (mounted) setState(() => _isLoadingSubtitles = true);

    try {
      final repo = ref.read(subtitleRepositoryProvider);
      final items = await repo.listSubtitles(
        widget.tmdbId,
        season: widget.season,
        episode: widget.episode,
      );
      items.sort((a, b) {
        final byPriority = _subtitleLanguageRank(a.language) -
            _subtitleLanguageRank(b.language);
        if (byPriority != 0) return byPriority;
        final byReleaseMatch =
            _subtitleReleaseMatchScore(b) - _subtitleReleaseMatchScore(a);
        if (byReleaseMatch != 0) return byReleaseMatch;
        if (a.hearingImpaired != b.hearingImpaired) {
          return a.hearingImpaired ? 1 : -1;
        }
        final byLanguage = a.language.compareTo(b.language);
        if (byLanguage != 0) return byLanguage;
        return a.releaseName.compareTo(b.releaseName);
      });

      if (!mounted) return;
      setState(() => _openSubtitles = items);
    } catch (_) {
      if (!mounted || !showErrorSnackBar) return;
      _showErrorSnackBar(
          'Impossible de charger les sous-titres OpenSubtitles Pro.');
    } finally {
      if (mounted) setState(() => _isLoadingSubtitles = false);
    }
  }

  Future<void> _loadMarkers() async {
    try {
      final repo = ref.read(subtitleRepositoryProvider);
      final markers = await repo.getMarkers(widget.tmdbId);
      final sanitized = markers
          .where((m) =>
              (m.type == 'intro' || m.type == 'outro') &&
              m.endTime > m.startTime)
          .toList(growable: false);
      if (!mounted) return;
      setState(() => _markers = sanitized);
    } catch (_) {
      if (!mounted) return;
      setState(() => _markers = const []);
    }
  }

  MediaMarker? _markerByType(String type) {
    for (final marker in _markers) {
      if (marker.type == type && marker.endTime > marker.startTime) {
        return marker;
      }
    }
    return null;
  }

  bool _isPositionInsideMarker(MediaMarker marker, Duration position) {
    final second = position.inSeconds;
    return second >= marker.startTime && second < marker.endTime;
  }

  MediaMarker? _activeIntroMarker(Duration position) {
    final intro = _markerByType('intro');
    if (intro == null || _skipIntroHandled) return null;
    if (_isPositionInsideMarker(intro, position)) return intro;
    return null;
  }

  bool _shouldOfferAutoNext(VideoPlayerState playerState) {
    if (!_canGoToNextEpisode) return false;
    if (playerState.isLoading || !playerState.isPlaying) return false;
    final outro = _markerByType('outro');
    if (outro != null) {
      return _isPositionInsideMarker(outro, playerState.position);
    }
    return playerState.nearEnd;
  }

  void _onPlaybackStateChanged(VideoPlayerState playerState) {
    final intro = _markerByType('intro');
    if (intro != null &&
        _skipIntroHandled &&
        playerState.position.inSeconds < intro.startTime) {
      setState(() => _skipIntroHandled = false);
    }

    final shouldOffer = _shouldOfferAutoNext(playerState);
    if (!shouldOffer) {
      if (_autoNextTimer != null || _autoNextCancelled) {
        setState(() {
          _stopAutoNextTimer(resetCountdown: true, resetCancellation: true);
        });
      }
      return;
    }

    if (_autoNextCancelled || _autoNextTimer != null) return;

    setState(() => _autoNextRemainingSeconds = _autoNextDelaySeconds);
    _autoNextTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      final currentState = ref.read(videoPlayerNotifierProvider);
      if (!_shouldOfferAutoNext(currentState)) {
        setState(() {
          _stopAutoNextTimer(resetCountdown: true, resetCancellation: true);
        });
        return;
      }
      if (_autoNextRemainingSeconds <= 1) {
        timer.cancel();
        setState(() {
          _stopAutoNextTimer(resetCountdown: true, resetCancellation: true);
        });
        unawaited(_goToNextEpisode());
        return;
      }
      setState(() => _autoNextRemainingSeconds -= 1);
    });
  }

  void _stopAutoNextTimer({
    bool resetCountdown = false,
    bool resetCancellation = false,
  }) {
    _autoNextTimer?.cancel();
    _autoNextTimer = null;
    if (resetCountdown) _autoNextRemainingSeconds = _autoNextDelaySeconds;
    if (resetCancellation) _autoNextCancelled = false;
  }

  Future<void> _skipIntro(MediaMarker marker) async {
    await ref
        .read(videoPlayerNotifierProvider.notifier)
        .skipToSecond(marker.endTime);
    if (!mounted) return;
    setState(() => _skipIntroHandled = true);
  }

  void _cancelAutoNextForCurrentEpisode() {
    if (!mounted) return;
    setState(() {
      _autoNextCancelled = true;
      _stopAutoNextTimer(resetCountdown: true, resetCancellation: false);
    });
  }

  Future<void> _handleStallExhausted() async {
    if (!mounted || _isSwitchingSource || _isBootstrapping) return;
    if (_sources.isEmpty) return;

    final failedKey = _activeSourceKey;
    if (failedKey != null) _exhaustedSourceKeys.add(failedKey);

    // Filtre les sources déjà épuisées pour ne pas reboucler.
    final candidates =
        _sources.where((s) => !_exhaustedSourceKeys.contains(s.key)).toList();
    if (candidates.isEmpty) return; // Toutes les sources ont échoué.

    if (mounted) setState(() => _isSwitchingSource = true);
    try {
      final nextKey = await _selectBestPlayableSource(
        preferredKey: candidates.first.key,
      );
      if (!mounted || nextKey == null || nextKey == failedKey) return;
      setState(() => _activeSourceKey = nextKey);
      final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
      await playerNotifier.loadStream(
        tmdbId: widget.tmdbId,
        mediaType: widget.mediaType,
        profileId: widget.profileId,
        season: widget.season,
        episode: widget.episode,
        startPosition: ref.read(videoPlayerNotifierProvider).position.inSeconds,
        sourceKey: nextKey,
      );
    } finally {
      if (mounted) setState(() => _isSwitchingSource = false);
    }
  }

  Future<String?> _selectBestPlayableSource({String? preferredKey}) async {
    final ordered = _orderedSourceCandidates(preferredKey);
    if (ordered.isEmpty) return null;

    final isApple = _isApplePlatform;
    final totalBudget =
        isApple ? const Duration(seconds: 8) : const Duration(seconds: 5);
    final maxSourcesToProbe = isApple ? 6 : 4;
    final deadline = DateTime.now().add(totalBudget);
    String? likelyAvailableKey;

    for (final source in ordered.take(maxSourcesToProbe)) {
      if (likelyAvailableKey == null && source.hasDirectUrl) {
        likelyAvailableKey = source.key;
      }
      final remaining = deadline.difference(DateTime.now());
      if (remaining <= Duration.zero) break;

      final maxProbeTimeout =
          isApple ? const Duration(seconds: 3) : const Duration(seconds: 2);
      final probeTimeout =
          remaining > maxProbeTimeout ? maxProbeTimeout : remaining;
      final probe =
          await _probeSourceAvailability(source.key, timeout: probeTimeout);
      if (probe.ok) return probe.selectedSourceKey ?? source.key;
    }

    if (likelyAvailableKey != null) return likelyAvailableKey;
    return ordered.first.key;
  }

  List<TorrentSource> _orderedSourceCandidates(String? preferredKey) {
    if (_sources.isEmpty) return const [];
    // Exclure les sources déjà épuisées (stall ou probe raté).
    final available =
        _sources.where((s) => !_exhaustedSourceKeys.contains(s.key)).toList();
    if (available.isEmpty) return _sources; // fallback : toutes, même épuisées
    final preferred = (preferredKey == null || preferredKey.isEmpty)
        ? <TorrentSource>[]
        : available.where((s) => s.key == preferredKey).toList();
    final others = available.where((s) => s.key != preferredKey).toList();

    if (_isApplePlatform) {
      others.sort((a, b) {
        final prefRankDelta =
            (a.preferenceRank ?? 99).compareTo(b.preferenceRank ?? 99);
        if (prefRankDelta != 0) return prefRankDelta;
        final sourceLanguageDelta =
            _sourceLanguageRank(a).compareTo(_sourceLanguageRank(b));
        if (sourceLanguageDelta != 0) return sourceLanguageDelta;
        final byStability = _nativeStabilityScore(b) - _nativeStabilityScore(a);
        if (byStability != 0) return byStability;
        final aSize = a.sizeGb ?? double.infinity;
        final bSize = b.sizeGb ?? double.infinity;
        if (aSize != bSize) return aSize.compareTo(bSize);
        return b.score - a.score;
      });
    }

    return [...preferred, ...others];
  }

  bool get _isApplePlatform =>
      defaultTargetPlatform == TargetPlatform.iOS ||
      defaultTargetPlatform == TargetPlatform.macOS;

  int _sourceLanguageRank(TorrentSource source) {
    final text = '${source.name} ${source.tags.join(' ')}'.toLowerCase();
    if (RegExp(r'\b(truefrench|vff|vfq)\b', caseSensitive: false)
        .hasMatch(text)) {
      return 0;
    }
    if (RegExp(r'\b(french|français|francais|vf)\b', caseSensitive: false)
            .hasMatch(text) &&
        !RegExp(r'\b(vostfr|subfrench|vost|rus|russian|italian|german|spanish)\b',
                caseSensitive: false)
            .hasMatch(text)) {
      return 1;
    }
    if (RegExp(r'\b(vostfr|subfrench|vost)\b', caseSensitive: false)
        .hasMatch(text)) {
      return 2;
    }
    if (RegExp(r'\b(english|anglais|eng)\b', caseSensitive: false)
        .hasMatch(text)) {
      return 3;
    }
    if (RegExp(r'\b(japanese|japonais|jpn)\b', caseSensitive: false)
        .hasMatch(text)) {
      return 4;
    }
    if (RegExp(r'\b(korean|coreen|coréen|kor)\b', caseSensitive: false)
        .hasMatch(text)) {
      return 5;
    }
    if (RegExp(r'\b(rus|russian|italian|german|spanish)\b',
            caseSensitive: false)
        .hasMatch(text)) {
      return 20;
    }
    return 10;
  }

  int _nativeStabilityScore(TorrentSource source) {
    final text = '${source.name} ${source.tags.join(' ')}'.toLowerCase();
    var score = 0;
    if (source.hasDirectUrl) score += 10;
    if ((source.cachedRank ?? 0) >= 2 ||
        text.contains('cached') ||
        text.contains('⚡')) {
      score += 7;
    }
    final resolution = source.resolution.toLowerCase();
    if (resolution == '720p') score += 5;
    if (resolution == '1080p') score += 4;
    if (resolution == '480p') score += 3;
    if (resolution == '4k' || resolution == '2160p') score -= 4;
    final size = source.sizeGb;
    if (size != null) {
      if (size <= 2.0) {
        score += 4;
      } else if (size <= 4.0) {
        score += 3;
      } else if (size <= 8.0) {
        score += 1;
      } else if (size >= 12.0) {
        score -= 4;
      }
    }
    return score;
  }

  Future<_SourceProbeResult> _probeSourceAvailability(
    String sourceKey, {
    Duration timeout = const Duration(seconds: 2),
  }) async {
    try {
      final dio = ref.read(apiClientProvider).dio;
      final path = _streamPath();
      final response = await dio.get<List<int>>(
        path,
        queryParameters: {'source_key': sourceKey},
        options: Options(
          responseType: ResponseType.bytes,
          sendTimeout: timeout,
          receiveTimeout: timeout,
          headers: const {'Range': 'bytes=0-1024'},
        ),
      );
      final code = response.statusCode ?? 0;
      if (code < 200 || code >= 300) return const _SourceProbeResult(ok: false);
      return _SourceProbeResult(
        ok: true,
        selectedSourceKey:
            response.headers.value('x-jojoflix-selected-source-key'),
      );
    } on DioException {
      return const _SourceProbeResult(ok: false);
    } catch (_) {
      return const _SourceProbeResult(ok: false);
    }
  }

  String _streamPath() {
    if (widget.mediaType == 'tv' &&
        widget.season != null &&
        widget.episode != null) {
      return '/api/stream/tv/${widget.tmdbId}/s/${widget.season}/e/${widget.episode}';
    }
    return '/api/stream/movie/${widget.tmdbId}';
  }

  void _syncTrackSelections() {
    final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
    final activeEmbeddedSubtitle = playerNotifier.activeEmbeddedSubtitleTrack;

    if (!mounted) return;
    setState(() {
      if (playerNotifier.isExternalSubtitleTrackSelected) {
        if (!_subtitleSelectionKey.startsWith('open:')) {
          _subtitleSelectionKey = 'external';
        }
      } else if (activeEmbeddedSubtitle != null) {
        _subtitleSelectionKey = 'embedded:${activeEmbeddedSubtitle.id}';
      } else {
        _subtitleSelectionKey = 'off';
      }
    });
  }

  Future<void> _seekBackward15() async {
    await ref.read(videoPlayerNotifierProvider.notifier).seekBackward();
  }

  Future<void> _seekForward15() async {
    await ref.read(videoPlayerNotifierProvider.notifier).seekForward();
  }

  int _subtitleLanguageRank(String language) {
    final normalized = language.toLowerCase().trim();
    if (normalized == 'fr' ||
        normalized.startsWith('fr-') ||
        normalized == 'french') {
      return 0;
    }
    if (normalized == 'en' ||
        normalized.startsWith('en-') ||
        normalized == 'english') {
      return 1;
    }
    if (normalized == 'ja' ||
        normalized.startsWith('ja-') ||
        normalized == 'japanese') {
      return 2;
    }
    if (normalized == 'ko' ||
        normalized.startsWith('ko-') ||
        normalized == 'korean') {
      return 3;
    }
    return 10;
  }

  bool get _canGoToPreviousEpisode =>
      widget.mediaType == 'tv' &&
      widget.season != null &&
      widget.episode != null &&
      widget.episode! > 1;

  bool get _canGoToNextEpisode =>
      widget.mediaType == 'tv' &&
      widget.season != null &&
      widget.episode != null;

  Future<void> _goToPreviousEpisode() async {
    if (!_canGoToPreviousEpisode) return;
    await _goToEpisode(widget.episode! - 1);
  }

  Future<void> _goToNextEpisode() async {
    if (!_canGoToNextEpisode) return;
    await _goToEpisode(widget.episode! + 1);
  }

  Future<void> _goToEpisode(int episodeNumber) async {
    if (!mounted || widget.mediaType != 'tv' || widget.season == null) return;
    _stopAutoNextTimer(resetCountdown: true, resetCancellation: true);
    final location = Uri(
      path: '/player/${widget.mediaType}/${widget.tmdbId}',
      queryParameters: {
        'profileId': widget.profileId,
        'season': widget.season!.toString(),
        'episode': episodeNumber.toString(),
        'startPosition': '0',
      },
    ).toString();
    context.go(location);
  }

  Future<void> _openSourceSelector() async {
    if (_sources.isEmpty || !_slowProvidersLoaded) {
      await _loadSources(includeSlowProviders: true);
    }
    if (!mounted) return;

    final selected = await showModalBottomSheet<TorrentSource>(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      builder: (context) => _SelectorSheet(
        title: 'Sources (${_sources.length})',
        child: _sources.isEmpty
            ? const Center(
                child: Text('Aucune source disponible',
                    style: TextStyle(color: AppColors.textSecondary)),
              )
            : ListView.separated(
                itemCount: _sources.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final source = _sources[index];
                  final isSelected = source.key == _activeSourceKey;
                  final tags = source.tags.isEmpty
                      ? ''
                      : ' • ${source.tags.join(' / ')}';
                  return ListTile(
                    selected: isSelected,
                    selectedColor: AppColors.textPrimary,
                    selectedTileColor: AppColors.surfaceVariant,
                    leading: Icon(
                      source.magnet.isNotEmpty ? Icons.download : Icons.link,
                      color: AppColors.textSecondary,
                    ),
                    title: Text(
                      source.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppColors.textPrimary),
                    ),
                    subtitle: Text(
                      '${source.providerLabel} • ${source.resolution} • ${source.sizeLabel} • score ${source.score}$tags',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppColors.textSecondary),
                    ),
                    trailing: isSelected
                        ? const Icon(Icons.check_circle,
                            color: AppColors.primary)
                        : null,
                    onTap: () => Navigator.of(context).pop(source),
                  );
                },
              ),
      ),
    );

    if (selected == null || selected.key == _activeSourceKey) return;

    final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
    if (mounted) setState(() => _isSwitchingSource = true);

    try {
      await playerNotifier.switchSource(selected.key);
      if (!mounted) return;
      setState(() {
        _activeSourceKey = selected.key;
        _subtitleSelectionKey = 'off';
      });
      await _persistPreferredSourceKey(selected.key);
      unawaited(_prewarmNextEpisode(preferredSourceKey: selected.key));
      _syncTrackSelections();
    } catch (_) {
      if (!mounted) return;
      _showErrorSnackBar('Impossible de changer de source.');
    } finally {
      if (mounted) setState(() => _isSwitchingSource = false);
    }
  }

  Future<void> _openAudioSelector() async {
    final dataFuture = _loadAudioSelectionData();

    final selectedTrack = await showModalBottomSheet<PlayerTrack>(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      builder: (context) => _SelectorSheet(
        title: 'Pistes audio',
        child: FutureBuilder<_AudioSelectionData>(
          future: dataFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(
                child: CircularProgressIndicator(color: AppColors.primary),
              );
            }
            if (snapshot.hasError || !snapshot.hasData) {
              return const Center(
                child: Text('Impossible de charger les pistes audio',
                    style: TextStyle(color: AppColors.textSecondary)),
              );
            }
            final data = snapshot.data!;
            if (data.tracks.isEmpty) {
              return const Center(
                child: Text('Aucune piste audio détectée',
                    style: TextStyle(color: AppColors.textSecondary)),
              );
            }
            return ListView.separated(
              itemCount: data.tracks.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final track = data.tracks[index];
                final trackLabel =
                    data.labelsByTrackId[track.id] ?? track.label;
                final isSelected = data.activeTrack != null &&
                    data.activeTrack!.id == track.id;
                return ListTile(
                  title: Text(trackLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppColors.textPrimary)),
                  trailing: isSelected
                      ? const Icon(Icons.check_circle, color: AppColors.primary)
                      : null,
                  onTap: () => Navigator.of(context).pop(track),
                );
              },
            );
          },
        ),
      ),
    );

    if (selectedTrack == null) return;
    if (mounted) setState(() => _isApplyingTrackChange = true);

    try {
      final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
      await playerNotifier.setAudioTrack(selectedTrack).timeout(
            const Duration(seconds: 15),
            onTimeout: () =>
                throw TimeoutException('audio track switch timed out'),
          );
      if (!mounted) return;
      unawaited(_saveSeriesAudioLang(selectedTrack));
      _syncTrackSelections();
    } catch (_) {
      if (!mounted) return;
      _showErrorSnackBar('Impossible de changer la piste audio.');
    } finally {
      if (mounted) setState(() => _isApplyingTrackChange = false);
    }
  }

  Future<_AudioSelectionData> _loadAudioSelectionData() async {
    final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
    final tracks = await playerNotifier.getAudioTracks();
    final activeAudio = playerNotifier.activeAudioTrack;
    final labelsByTrackId = await _resolveAudioLabels(tracks);
    return _AudioSelectionData(
      tracks: tracks,
      activeTrack: activeAudio,
      labelsByTrackId: labelsByTrackId,
    );
  }

  String _preferredSourceStorageKey() {
    final season = widget.season ?? 0;
    return 'preferred_source:${widget.profileId}:${widget.mediaType}:${widget.tmdbId}:s$season';
  }

  bool get _isTvSeries => widget.mediaType == 'tv';

  String _seriesSubDelayKey() =>
      'series_sub_delay_ms:${widget.profileId}:${widget.tmdbId}';

  String _seriesSubProviderKey() =>
      'series_sub_provider:${widget.profileId}:${widget.tmdbId}';

  String _seriesAudioLangKey() =>
      'series_audio_lang:${widget.profileId}:${widget.tmdbId}';

  Future<void> _saveSeriesSubDelay(int ms) async {
    if (!_isTvSeries) return;
    final prefs = ref.read(sharedPreferencesProvider);
    await prefs.setInt(_seriesSubDelayKey(), ms);
  }

  Future<void> _saveSeriesSubProvider(String fileId) async {
    if (!_isTvSeries) return;
    final provider = fileId.startsWith('subdl:')
        ? 'subdl'
        : fileId.startsWith('subsource:html:')
            ? 'subsource'
            : 'opensubtitles';
    await _saveSeriesSubProviderValue(provider);
  }

  Future<void> _saveSeriesEmbeddedSubProvider(PlayerTrack track) async {
    if (!_isTvSeries) return;
    final notifier = ref.read(videoPlayerNotifierProvider.notifier);
    final lang = notifier.getSubtitleTrackLanguage(track.id);
    final provider =
        lang == null || lang.isEmpty ? 'embedded' : 'embedded:$lang';
    await _saveSeriesSubProviderValue(provider);
  }

  Future<void> _saveSeriesSubProviderValue(String provider) async {
    if (!_isTvSeries) return;
    final prefs = ref.read(sharedPreferencesProvider);
    await prefs.setString(_seriesSubProviderKey(), provider);
  }

  Future<void> _saveSeriesAudioLang(PlayerTrack track) async {
    if (!_isTvSeries) return;
    final notifier = ref.read(videoPlayerNotifierProvider.notifier);
    final lang = notifier.getAudioTrackLanguage(track.id);
    if (lang == null || lang.isEmpty) return;
    final prefs = ref.read(sharedPreferencesProvider);
    await prefs.setString(_seriesAudioLangKey(), lang);
    notifier.setAudioLanguagePreference(lang);
  }

  Future<void> _restoreSeriesPreferences() async {
    if (!_isTvSeries) return;
    final prefs = ref.read(sharedPreferencesProvider);
    final notifier = ref.read(videoPlayerNotifierProvider.notifier);

    // Restore audio language override first (before track polling).
    final savedLang = prefs.getString(_seriesAudioLangKey());
    if (savedLang != null && savedLang.isNotEmpty) {
      notifier.setAudioLanguagePreference(savedLang);
    }

    // Restore subtitle delay.
    final savedDelay = prefs.getInt(_seriesSubDelayKey());
    if (savedDelay != null && savedDelay != 0) {
      await notifier.setSubtitleDelayMs(savedDelay);
    }

    final savedSubProvider = prefs.getString(_seriesSubProviderKey());
    if (savedSubProvider == 'off') {
      await notifier.disableSubtitles();
      if (mounted) setState(() => _subtitleSelectionKey = 'off');
    } else if (savedSubProvider?.startsWith('embedded') == true) {
      await _applySavedEmbeddedSubtitleProvider(savedSubProvider!);
    }
  }

  String? _savedSeriesSubProvider() {
    if (!_isTvSeries) return null;
    return ref
        .read(sharedPreferencesProvider)
        .getString(_seriesSubProviderKey());
  }

  Future<void> _applySavedEmbeddedSubtitleProvider(String provider) async {
    final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
    final tracks = playerNotifier.subtitleTracks;
    if (tracks.isEmpty) return;

    final parts = provider.split(':');
    final savedLang = parts.length > 1 ? parts[1].trim().toLowerCase() : '';
    PlayerTrack? selected;
    if (savedLang.isNotEmpty) {
      for (final track in tracks) {
        final lang = playerNotifier.getSubtitleTrackLanguage(track.id);
        if (_languageMatchesPreference(lang, savedLang)) {
          selected = track;
          break;
        }
      }
      if (selected == null) return;
    } else {
      selected = playerNotifier.activeEmbeddedSubtitleTrack ?? tracks.first;
    }

    await playerNotifier.setEmbeddedSubtitleTrack(selected);
    if (!mounted) return;
    setState(() => _subtitleSelectionKey = 'embedded:${selected!.id}');
  }

  bool _languageMatchesPreference(String? language, String preferred) {
    final normalized = language?.trim().toLowerCase();
    if (normalized == null || normalized.isEmpty) return false;
    if (normalized == preferred) return true;
    const aliases = {
      'fr': ['fr', 'fra', 'fre', 'french'],
      'fra': ['fr', 'fra', 'fre', 'french'],
      'fre': ['fr', 'fra', 'fre', 'french'],
      'en': ['en', 'eng', 'english'],
      'eng': ['en', 'eng', 'english'],
      'ko': ['ko', 'kor', 'korean'],
      'kor': ['ko', 'kor', 'korean'],
      'ja': ['ja', 'jpn', 'japanese'],
      'jpn': ['ja', 'jpn', 'japanese'],
    };
    return aliases[preferred]?.contains(normalized) ?? false;
  }

  // Les sources RD expirent — on ne garde la préférence que 24h.
  static const _preferredSourceMaxAgeMs = 24 * 60 * 60 * 1000;

  Future<void> _restorePreferredSource() async {
    if (_activeSourceKey != null && _activeSourceKey!.isNotEmpty) return;
    final prefs = ref.read(sharedPreferencesProvider);
    final saved = prefs.getString(_preferredSourceStorageKey());
    if (saved == null || saved.isEmpty) return;

    // Format: "sourceKey|savedAtMs"
    final parts = saved.split('|');
    if (parts.length < 2) {
      // Ancienne entrée sans timestamp → ignorer
      await prefs.remove(_preferredSourceStorageKey());
      return;
    }
    final savedAtMs = int.tryParse(parts.last);
    if (savedAtMs == null) return;
    if (DateTime.now().millisecondsSinceEpoch - savedAtMs >
        _preferredSourceMaxAgeMs) {
      await prefs.remove(_preferredSourceStorageKey());
      return;
    }
    _activeSourceKey = parts.sublist(0, parts.length - 1).join('|');
  }

  Future<void> _persistPreferredSourceKey(String sourceKey) async {
    if (sourceKey.isEmpty) return;
    final prefs = ref.read(sharedPreferencesProvider);
    final savedAtMs = DateTime.now().millisecondsSinceEpoch;
    await prefs.setString(
        _preferredSourceStorageKey(), '$sourceKey|$savedAtMs');
  }

  Future<void> _prewarmNextEpisode({String? preferredSourceKey}) async {
    if (widget.mediaType != 'tv' ||
        widget.season == null ||
        widget.episode == null) {
      return;
    }
    try {
      await ref.read(sourceRepositoryProvider).prewarmNextEpisode(
            widget.tmdbId,
            widget.season!,
            widget.episode! + 1,
            sourceKey: preferredSourceKey,
          );
    } catch (_) {
      // Best-effort: ne bloque jamais le playback courant.
    }
  }

  Future<void> _openSubtitleSelector() async {
    final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
    final embeddedTracks = playerNotifier.subtitleTracks;

    final choice = await showModalBottomSheet<_SubtitleChoice>(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      builder: (context) => _SelectorSheet(
        title: 'Sous-titres',
        child: ListView(
          children: [
            ListTile(
              title: const Text('Désactiver les sous-titres',
                  style: TextStyle(color: AppColors.textPrimary)),
              trailing: _subtitleSelectionKey == 'off'
                  ? const Icon(Icons.check_circle, color: AppColors.primary)
                  : null,
              onTap: () =>
                  Navigator.of(context).pop(const _SubtitleChoice.disable()),
            ),
            const Divider(height: 1),
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: Text('Pistes intégrées',
                  style: TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 12,
                      fontWeight: FontWeight.w600)),
            ),
            if (embeddedTracks.isEmpty)
              const ListTile(
                title: Text('Aucun sous-titre intégré détecté',
                    style: TextStyle(color: AppColors.textSecondary)),
              )
            else
              ...embeddedTracks.map((track) {
                final key = 'embedded:${track.id}';
                return ListTile(
                  title: Text(track.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppColors.textPrimary)),
                  trailing: _subtitleSelectionKey == key
                      ? const Icon(Icons.check_circle, color: AppColors.primary)
                      : null,
                  onTap: () => Navigator.of(context)
                      .pop(_SubtitleChoice.embedded(track)),
                );
              }),
            const Divider(height: 1),
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: Text('OpenSubtitles Pro',
                  style: TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 12,
                      fontWeight: FontWeight.w600)),
            ),
            if (_isLoadingSubtitles)
              const Padding(
                padding: EdgeInsets.all(16),
                child: Center(
                    child: CircularProgressIndicator(color: AppColors.primary)),
              )
            else if (_openSubtitles.isEmpty)
              const ListTile(
                title: Text('Aucun sous-titre OpenSubtitles disponible',
                    style: TextStyle(color: AppColors.textSecondary)),
              )
            else
              ..._openSubtitles.map((entry) {
                final key = _openSubtitleSelectionKey(entry);
                return ListTile(
                  title: Text(entry.displayName,
                      style: const TextStyle(color: AppColors.textPrimary)),
                  subtitle: entry.releaseName.isNotEmpty
                      ? Text(entry.releaseName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style:
                              const TextStyle(color: AppColors.textSecondary))
                      : null,
                  trailing: _subtitleSelectionKey == key
                      ? const Icon(Icons.check_circle, color: AppColors.primary)
                      : null,
                  onTap: () => Navigator.of(context)
                      .pop(_SubtitleChoice.openSubtitle(entry)),
                );
              }),
          ],
        ),
      ),
    );

    if (choice == null) return;
    if (mounted) setState(() => _isApplyingTrackChange = true);

    try {
      switch (choice.kind) {
        case _SubtitleChoiceKind.disable:
          await playerNotifier.disableSubtitles();
          if (!mounted) return;
          setState(() => _subtitleSelectionKey = 'off');
          unawaited(_saveSeriesSubProviderValue('off'));

        case _SubtitleChoiceKind.embedded:
          final track = choice.embeddedTrack!;
          await playerNotifier.setEmbeddedSubtitleTrack(track);
          if (!mounted) return;
          setState(() => _subtitleSelectionKey = 'embedded:${track.id}');
          unawaited(_saveSeriesEmbeddedSubProvider(track));

        case _SubtitleChoiceKind.openSubtitle:
          final entry = choice.openSubtitle!;
          final appliedEntry = await _applyOpenSubtitleWithFallback(entry);
          if (!mounted) return;
          setState(() =>
              _subtitleSelectionKey = _openSubtitleSelectionKey(appliedEntry));
          unawaited(_saveSeriesSubProvider(appliedEntry.fileId));
          if (appliedEntry.fileId != entry.fileId) {
            _showInfoSnackBar(
                'Sous-titre alternatif chargé (${appliedEntry.displayName}).');
          }
      }
    } catch (_) {
      if (!mounted) return;
      _showErrorSnackBar('Impossible de changer les sous-titres.');
    } finally {
      if (mounted) setState(() => _isApplyingTrackChange = false);
    }
  }

  Future<void> _openSubtitleSyncSheet() async {
    final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
    if (!mounted) return;

    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setSheetState) {
          Future<void> apply(Future<void> Function() action) async {
            if (mounted) setState(() => _isApplyingTrackChange = true);
            try {
              await action();
              if (!mounted) return;
              _syncTrackSelections();
              setSheetState(() {});
              unawaited(_saveSeriesSubDelay(playerNotifier.subtitleDelayMs));
            } catch (_) {
              if (!mounted) return;
              _showErrorSnackBar("Impossible d'appliquer la synchro ST.");
            } finally {
              if (mounted) setState(() => _isApplyingTrackChange = false);
            }
          }

          final delayMs = playerNotifier.subtitleDelayMs;
          final scalePercent = (playerNotifier.subtitleScale - 1.0) * 100;

          return _SelectorSheet(
            title: 'Synchronisation ST',
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.lg),
              children: [
                _SubtitleDelayRow(
                  delayMs: delayMs,
                  onStep: (delta) =>
                      apply(() => playerNotifier.adjustSubtitleDelay(delta)),
                  onReset: () => apply(() async {
                    await playerNotifier.resetSubtitleTiming();
                    unawaited(_saveSeriesSubDelay(0));
                  }),
                ),
                const SizedBox(height: AppSpacing.md),
                _SyncStepperRow(
                  label: 'Dérive temporelle',
                  hint: '%',
                  value:
                      '${scalePercent >= 0 ? '+' : ''}${scalePercent.toStringAsFixed(1)}',
                  onMinus: () =>
                      apply(() => playerNotifier.adjustSubtitleScale(-0.005)),
                  onPlus: () =>
                      apply(() => playerNotifier.adjustSubtitleScale(0.005)),
                ),
                const SizedBox(height: AppSpacing.sm),
                const Text(
                  'Actif sur la piste de sous-titres en cours. Le décalage est mémorisé pour tous les épisodes de cette série.',
                  style: TextStyle(color: AppColors.textSecondary),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Future<void> _adjustSubtitleDelayAndPersist(int deltaMs) async {
    final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
    await playerNotifier.adjustSubtitleDelay(deltaMs);
    unawaited(_saveSeriesSubDelay(playerNotifier.subtitleDelayMs));
    if (!mounted) return;
    setState(() {});
  }

  Future<Map<int, String>> _resolveAudioLabels(List<PlayerTrack> tracks) async {
    final labels = <int, String>{
      for (final track in tracks) track.id: track.label,
    };
    try {
      final infos =
          await ref.read(transcodeRepositoryProvider).getAudioTracks();
      for (final info in infos) {
        final id = info.index;
        if (!labels.containsKey(id)) continue;
        labels[id] = _formatAudioTrackLabel(info);
      }
    } catch (_) {
      // FFprobe indisponible; on garde les labels natifs media_kit.
    }
    return labels;
  }

  String _formatAudioTrackLabel(AudioTrackInfo info) {
    final base = info.displayName.trim();
    final details = <String>[];
    if (info.codec.isNotEmpty) details.add(info.codec.toUpperCase());
    if (info.channels > 0) details.add('${info.channels}ch');
    if (details.isEmpty) return base;
    return '$base • ${details.join(' • ')}';
  }

  String _openSubtitleSelectionKey(SubtitleEntry entry) {
    final release = entry.releaseName
        .trim()
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '_');
    final releasePart = release.isEmpty ? 'na' : release;
    return 'open:${entry.fileId}:${entry.language.toLowerCase()}:$releasePart';
  }

  List<SubtitleEntry> _subtitleFallbackCandidates(SubtitleEntry preferred) {
    final preferredLanguage = preferred.language.toLowerCase().trim();
    final preferredScore = _subtitleReleaseMatchScore(preferred);
    final sameLanguage = _openSubtitles
        .where((entry) =>
            entry.fileId != preferred.fileId &&
            entry.language.toLowerCase().trim() == preferredLanguage)
        .toList(growable: false)
      ..sort((a, b) =>
          _subtitleReleaseMatchScore(b) - _subtitleReleaseMatchScore(a));

    final releaseMatched = sameLanguage.where((entry) {
      final score = _subtitleReleaseMatchScore(entry);
      if (score <= 0) return false;
      if (preferredScore <= 0) return true;
      return score >= preferredScore - 2;
    }).take(2);
    return [preferred, ...releaseMatched];
  }

  Future<void> _maybeAutoApplyExternalFrenchSubtitle() async {
    final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
    if (playerNotifier.isExternalSubtitleTrackSelected) return;
    final savedProvider = _savedSeriesSubProvider();
    if (savedProvider == 'off' ||
        savedProvider?.startsWith('embedded') == true) {
      return;
    }
    if (playerNotifier.activeEmbeddedSubtitleTrack != null &&
        savedProvider == null) {
      return;
    }

    final frenchSubtitles = _openSubtitles.where((entry) {
      final lang = entry.language.toLowerCase().trim();
      return lang == 'fr' || lang.startsWith('fr-') || lang == 'french';
    }).toList();

    if (frenchSubtitles.isEmpty) return;

    List<SubtitleEntry> candidates = frenchSubtitles;
    if (savedProvider != null) {
      final preferred = frenchSubtitles.where((e) {
        if (savedProvider == 'subdl') return e.fileId.startsWith('subdl:');
        if (savedProvider == 'subsource') {
          return e.fileId.startsWith('subsource:html:');
        }
        return !e.fileId.startsWith('subdl:') &&
            !e.fileId.startsWith('subsource:html:');
      }).toList();
      if (preferred.isNotEmpty) candidates = preferred;
    }

    try {
      final best = candidates.first;
      final appliedEntry = await _applyOpenSubtitleWithFallback(best);
      if (!mounted) return;
      setState(() =>
          _subtitleSelectionKey = _openSubtitleSelectionKey(appliedEntry));
    } catch (_) {
      // Best effort — ne bloque pas le playback.
    }
  }

  int _subtitleReleaseMatchScore(SubtitleEntry entry) {
    final activeSource = _currentSource();
    if (activeSource == null) return 0;

    final sourceName = activeSource.rawName.isNotEmpty
        ? activeSource.rawName.trim().toLowerCase()
        : '${activeSource.name} ${activeSource.tags.join(' ')}'
            .trim()
            .toLowerCase();
    final releaseName = entry.releaseName.trim().toLowerCase();
    if (sourceName.isEmpty || releaseName.isEmpty) return 0;

    final normalizedSource = _normalizeReleaseLabel(sourceName);
    final normalizedRelease = _normalizeReleaseLabel(releaseName);
    if (normalizedSource.isEmpty || normalizedRelease.isEmpty) return 0;

    var score = 0;
    if (normalizedSource == normalizedRelease) score += 12;
    if (normalizedSource.contains(normalizedRelease) ||
        normalizedRelease.contains(normalizedSource)) {
      score += 8;
    }

    final sourceTokens = _releaseTokens(sourceName);
    final releaseTokens = _releaseTokens(releaseName);
    if (sourceTokens.isEmpty || releaseTokens.isEmpty) return score;

    for (final token in releaseTokens) {
      if (!sourceTokens.contains(token)) continue;
      if (RegExp(r'^\d{3,4}p$').hasMatch(token)) {
        score += 3;
        continue;
      }
      if (RegExp(
              r'^(x26[45]|h\.?26[45]|hevc|xvid|bluray|brrip|webrip|webdl|web-dl|hdrip|dvdrip)$')
          .hasMatch(token)) {
        score += 2;
        continue;
      }
      if (token.length >= 4) score += 1;
    }

    return score;
  }

  String _normalizeReleaseLabel(String value) {
    return value
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
  }

  Set<String> _releaseTokens(String value) {
    final normalized = _normalizeReleaseLabel(value);
    if (normalized.isEmpty) return const {};
    return normalized.split(' ').where((token) => token.length >= 2).toSet();
  }

  Future<SubtitleEntry> _applyOpenSubtitleWithFallback(
      SubtitleEntry preferred) async {
    final repo = ref.read(subtitleRepositoryProvider);
    final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
    final candidates = _subtitleFallbackCandidates(preferred);
    final deadline = DateTime.now().add(const Duration(seconds: 120));
    Object? lastError;

    for (final entry in candidates.take(4)) {
      final remaining = deadline.difference(DateTime.now());
      if (remaining <= Duration.zero) break;

      final downloadTimeout = remaining > const Duration(seconds: 90)
          ? const Duration(seconds: 90)
          : remaining;
      const loadTimeout = Duration(seconds: 8);

      try {
        final subtitleUrl = await repo.downloadSubtitle(
          entry.fileId,
          entry.language,
          timeout: downloadTimeout,
        );
        if (!mounted) break;
        await playerNotifier.loadSubtitle(_withCacheBust(subtitleUrl),
            timeout: loadTimeout);
        return entry;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError != null) throw lastError;
    throw Exception('SUBTITLE_LOAD_FAILED');
  }

  String _withCacheBust(String url) {
    final uri = Uri.parse(url);
    final params = Map<String, String>.from(uri.queryParameters);
    params['_ts'] = DateTime.now().millisecondsSinceEpoch.toString();
    return uri.replace(queryParameters: params).toString();
  }

  void _showErrorSnackBar(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      backgroundColor: AppColors.surfaceVariant,
      content: Text(message),
    ));
  }

  void _showInfoSnackBar(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      backgroundColor: AppColors.surfaceVariant,
      content: Text(message),
      duration: const Duration(seconds: 2),
    ));
  }

  void _goBackToDetail() {
    if (!mounted) return;
    context.go('/detail/${widget.mediaType}/${widget.tmdbId}');
  }

  TorrentSource? _currentSource() {
    if (_activeSourceKey == null) return null;
    for (final source in _sources) {
      if (source.key == _activeSourceKey) return source;
    }
    return null;
  }

  Future<String?> _startNativePlayback(
    VideoPlayerNotifier playerNotifier, {
    String? sourceKey,
  }) async {
    final probe = sourceKey == null
        ? const _SourceProbeResult(ok: false)
        : await _probeSourceAvailability(sourceKey,
            timeout: const Duration(seconds: 3));
    final effectiveSourceKey = probe.selectedSourceKey ?? sourceKey;
    await playerNotifier.loadStream(
      tmdbId: widget.tmdbId,
      mediaType: widget.mediaType,
      profileId: widget.profileId,
      season: widget.season,
      episode: widget.episode,
      startPosition: widget.startPosition,
      sourceKey: effectiveSourceKey,
    );
    if (mounted &&
        effectiveSourceKey != null &&
        effectiveSourceKey.isNotEmpty &&
        effectiveSourceKey != _activeSourceKey) {
      setState(() => _activeSourceKey = effectiveSourceKey);
    }
    return effectiveSourceKey;
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    ref.listen(videoPlayerNotifierProvider, (prev, next) {
      _onPlaybackStateChanged(next);
      if (next.stallRecoveryExhausted &&
          !(prev?.stallRecoveryExhausted ?? false)) {
        unawaited(_handleStallExhausted());
      }
    });

    final playerState = ref.watch(videoPlayerNotifierProvider);
    final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
    final introMarker = _activeIntroMarker(playerState.position);
    final showAutoNext =
        _canGoToNextEpisode && !_autoNextCancelled && _autoNextTimer != null;
    final isBusy = _isBootstrapping ||
        playerState.isLoading ||
        _isSwitchingSource ||
        _isApplyingTrackChange;

    if (_fatalError != null) {
      return ExcludeSemantics(
        child: Scaffold(
          backgroundColor: AppColors.background,
          body: SafeArea(
            child: ErrorRetryWidget(
              message: _fatalError!,
              onRetry: _bootstrap,
            ),
          ),
        ),
      );
    }

    // Titre réel affiché dans l'overlay (bug fix : ne plus montrer "Lecture film")
    final displayTitle = widget.title?.trim().isNotEmpty == true
        ? widget.title!.trim()
        : widget.mediaType == 'tv'
            ? 'Série'
            : 'Film';
    final displaySubtitle = _resolveDisplaySubtitle();

    return ExcludeSemantics(
      child: Scaffold(
        backgroundColor: Colors.black,
        body: _isInPictureInPicture
            ? _buildPiPView(playerNotifier, isBusy)
            : _buildFullscreenView(
                playerState,
                playerNotifier,
                isBusy,
                introMarker,
                showAutoNext,
                displayTitle,
                displaySubtitle,
              ),
      ),
    );
  }

  String? _resolveDisplaySubtitle() {
    if (widget.mediaType != 'tv') return null;
    if (widget.season == null || widget.episode == null) return null;
    final fromWidget = widget.subtitle?.trim();
    if (fromWidget != null && fromWidget.isNotEmpty) return fromWidget;
    return 'S${widget.season} E${widget.episode}';
  }

  Widget _buildPiPView(VideoPlayerNotifier playerNotifier, bool isBusy) {
    return Stack(
      fit: StackFit.expand,
      children: [
        Video(
          controller: playerNotifier.videoController,
          fit: BoxFit.contain,
          controls: NoVideoControls,
          subtitleViewConfiguration: const SubtitleViewConfiguration(),
        ),
        if (isBusy) const ColoredBox(color: Colors.black26),
      ],
    );
  }

  Widget _buildFullscreenView(
    VideoPlayerState playerState,
    VideoPlayerNotifier playerNotifier,
    bool isBusy,
    MediaMarker? introMarker,
    bool showAutoNext,
    String displayTitle,
    String? displaySubtitle,
  ) {
    return Stack(
      fit: StackFit.expand,
      children: [
        // Vidéo plein écran, sans SafeArea
        Video(
          controller: playerNotifier.videoController,
          fit: BoxFit.contain,
          controls: NoVideoControls,
          subtitleViewConfiguration: const SubtitleViewConfiguration(
            // Remonter les sous-titres pour ne pas les couvrir par la barre du bas
            padding: EdgeInsets.only(bottom: 72),
          ),
        ),

        // Overlay de contrôles auto-hide
        _PlayerControls(
          playerState: playerState,
          title: displayTitle,
          subtitle: displaySubtitle,
          isLoadingSources: _isLoadingSources,
          sourcesCount: _sources.length,
          canGoPrev: _canGoToPreviousEpisode,
          canGoNext: _canGoToNextEpisode,
          onBack: _goBackToDetail,
          onTogglePlayPause: () => unawaited(playerNotifier.togglePlayPause()),
          onSeekBackward: () => unawaited(_seekBackward15()),
          onSeekForward: () => unawaited(_seekForward15()),
          onSeek: (pos) => unawaited(playerNotifier.seekTo(pos)),
          onOpenSources: () => unawaited(_openSourceSelector()),
          onOpenAudio: () => unawaited(_openAudioSelector()),
          onOpenSubtitles: () => unawaited(_openSubtitleSelector()),
          onOpenSubtitleSync: () => unawaited(_openSubtitleSyncSheet()),
          onPreviousEpisode: _canGoToPreviousEpisode
              ? () => unawaited(_goToPreviousEpisode())
              : null,
          onNextEpisode:
              _canGoToNextEpisode ? () => unawaited(_goToNextEpisode()) : null,
          onAdjustSubtitleDelay: (deltaMs) =>
              unawaited(_adjustSubtitleDelayAndPersist(deltaMs)),
        ),

        // Spinner de chargement (toujours visible, pas masqué par auto-hide)
        if (isBusy)
          const Center(
            child: CircularProgressIndicator(color: AppColors.primary),
          ),

        // Bouton "Passer l'intro" — bottom-right, au-dessus de la barre
        if (introMarker != null)
          Positioned(
            right: AppSpacing.lg,
            bottom: 88,
            child: SafeArea(
              top: false,
              child: _SkipIntroButton(
                onTap: () => _skipIntro(introMarker),
              ),
            ),
          ),

        // Card épisode suivant — bottom-right
        if (showAutoNext)
          Positioned(
            right: AppSpacing.lg,
            bottom: AppSpacing.xl,
            child: SafeArea(
              top: false,
              child: _AutoNextCard(
                remainingSeconds: _autoNextRemainingSeconds,
                onCancel: _cancelAutoNextForCurrentEpisode,
                onPlayNow: _goToNextEpisode,
              ),
            ),
          ),
      ],
    );
  }
}

// =============================================================================
// Overlay de contrôles (auto-hide)
// =============================================================================

class _PlayerControls extends StatefulWidget {
  final VideoPlayerState playerState;
  final String title;
  final String? subtitle;
  final bool isLoadingSources;
  final int sourcesCount;
  final bool canGoPrev;
  final bool canGoNext;
  final VoidCallback onBack;
  final VoidCallback onTogglePlayPause;
  final VoidCallback onSeekBackward;
  final VoidCallback onSeekForward;
  final ValueChanged<Duration> onSeek;
  final VoidCallback onOpenSources;
  final VoidCallback onOpenAudio;
  final VoidCallback onOpenSubtitles;
  final VoidCallback onOpenSubtitleSync;
  final VoidCallback? onPreviousEpisode;
  final VoidCallback? onNextEpisode;
  final ValueChanged<int> onAdjustSubtitleDelay;

  const _PlayerControls({
    required this.playerState,
    required this.title,
    this.subtitle,
    required this.isLoadingSources,
    required this.sourcesCount,
    required this.canGoPrev,
    required this.canGoNext,
    required this.onBack,
    required this.onTogglePlayPause,
    required this.onSeekBackward,
    required this.onSeekForward,
    required this.onSeek,
    required this.onOpenSources,
    required this.onOpenAudio,
    required this.onOpenSubtitles,
    required this.onOpenSubtitleSync,
    this.onPreviousEpisode,
    this.onNextEpisode,
    required this.onAdjustSubtitleDelay,
  });

  @override
  State<_PlayerControls> createState() => _PlayerControlsState();
}

class _PlayerControlsState extends State<_PlayerControls> {
  static const _autoHideDuration = Duration(seconds: 4);

  bool _visible = true;
  Timer? _hideTimer;
  // Non-null while the user is dragging the seek bar.
  double? _seekDragValue;

  @override
  void initState() {
    super.initState();
    _scheduleHide();
  }

  @override
  void dispose() {
    _hideTimer?.cancel();
    super.dispose();
  }

  @override
  void didUpdateWidget(_PlayerControls old) {
    super.didUpdateWidget(old);
    // Pause → keep overlay visible, cancel hide timer.
    if (old.playerState.isPlaying && !widget.playerState.isPlaying) {
      _hideTimer?.cancel();
      if (!_visible) {
        setState(() => _visible = true);
      }
    }
    // Resume → restart auto-hide if overlay is visible.
    if (!old.playerState.isPlaying &&
        widget.playerState.isPlaying &&
        _visible) {
      _scheduleHide();
    }
  }

  void _scheduleHide() {
    _hideTimer?.cancel();
    // Don't auto-hide while paused or while the user is dragging.
    if (!widget.playerState.isPlaying || _seekDragValue != null) return;
    _hideTimer = Timer(_autoHideDuration, () {
      if (mounted) setState(() => _visible = false);
    });
  }

  void _show() {
    if (!_visible) setState(() => _visible = true);
    _scheduleHide();
  }

  void _onBackgroundTap() {
    if (_visible) {
      _hideTimer?.cancel();
      setState(() => _visible = false);
    } else {
      _show();
    }
  }

  String _fmt(Duration d) {
    final h = d.inHours;
    final m = (d.inMinutes % 60).toString().padLeft(2, '0');
    final s = (d.inSeconds % 60).toString().padLeft(2, '0');
    return h > 0 ? '${h.toString().padLeft(2, '0')}:$m:$s' : '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final ps = widget.playerState;
    final totalMs = ps.duration.inMilliseconds;
    final posMs = ps.position.inMilliseconds;
    final seekValue = _seekDragValue ??
        (totalMs > 0 ? (posMs / totalMs).clamp(0.0, 1.0) : 0.0);
    final displayPosition = _seekDragValue != null
        ? Duration(milliseconds: (_seekDragValue! * totalMs).round())
        : ps.position;

    return Focus(
      autofocus: true,
      onKeyEvent: _handleKeyEvent,
      child: Stack(
        fit: StackFit.expand,
        children: [
          // Background tap: toggle overlay visibility.
          // Placed first (bottom Z) so button taps above it win.
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: _onBackgroundTap,
            child: const SizedBox.expand(),
          ),

          // Controls (interactive only when visible).
          IgnorePointer(
            ignoring: !_visible,
            child: AnimatedOpacity(
              opacity: _visible ? 1.0 : 0.0,
              duration: const Duration(milliseconds: 250),
              child: Stack(
                children: [
                  // Top bar
                  Positioned(
                    top: 0,
                    left: 0,
                    right: 0,
                    child: _buildTopBar(),
                  ),
                  // Bottom bar
                  Positioned(
                    bottom: 0,
                    left: 0,
                    right: 0,
                    child: _buildBottomBar(ps, seekValue, displayPosition),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  KeyEventResult _handleKeyEvent(FocusNode node, KeyEvent event) {
    // Fire on press and repeat (held key), ignore release.
    if (event is KeyUpEvent) return KeyEventResult.ignored;

    _show();

    switch (event.logicalKey) {
      // Play / Pause
      case LogicalKeyboardKey.select:
      case LogicalKeyboardKey.enter:
      case LogicalKeyboardKey.space:
      case LogicalKeyboardKey.mediaPlayPause:
        widget.onTogglePlayPause();
        return KeyEventResult.handled;

      // Seek backward
      case LogicalKeyboardKey.arrowLeft:
      case LogicalKeyboardKey.mediaRewind:
        widget.onSeekBackward();
        return KeyEventResult.handled;

      // Seek forward
      case LogicalKeyboardKey.arrowRight:
      case LogicalKeyboardKey.mediaFastForward:
        widget.onSeekForward();
        return KeyEventResult.handled;

      // Back / Exit
      case LogicalKeyboardKey.escape:
      case LogicalKeyboardKey.goBack:
        widget.onBack();
        return KeyEventResult.handled;

      // Up/Down: just show overlay (volume etc. can come later)
      case LogicalKeyboardKey.arrowUp:
      case LogicalKeyboardKey.arrowDown:
        return KeyEventResult.handled;

      // Subtitle delay: [ = -250ms, ] = +250ms
      case LogicalKeyboardKey.bracketLeft:
        widget.onAdjustSubtitleDelay(-250);
        return KeyEventResult.handled;

      case LogicalKeyboardKey.bracketRight:
        widget.onAdjustSubtitleDelay(250);
        return KeyEventResult.handled;
    }

    return KeyEventResult.ignored;
  }

  Widget _buildTopBar() {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xCC000000), Colors.transparent],
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(4, 4, 8, 28),
          child: Row(
            children: [
              // Retour
              _OverlayIconButton(
                icon: Icons.arrow_back,
                tooltip: 'Retour',
                size: 26,
                onTap: () {
                  _show();
                  widget.onBack();
                },
              ),
              const SizedBox(width: 4),

              // Titre + sous-titre
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      widget.title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        shadows: [Shadow(color: Colors.black54, blurRadius: 6)],
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (widget.subtitle != null)
                      Text(
                        widget.subtitle!,
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 13,
                          shadows: [
                            Shadow(color: Colors.black54, blurRadius: 4)
                          ],
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                  ],
                ),
              ),

              // Boutons d'action
              _OverlayIconButton(
                icon: Icons.audiotrack_outlined,
                tooltip: 'Piste audio',
                onTap: () {
                  _show();
                  widget.onOpenAudio();
                },
              ),
              _OverlayIconButton(
                icon: Icons.subtitles_outlined,
                tooltip: 'Sous-titres',
                onTap: () {
                  _show();
                  widget.onOpenSubtitles();
                },
              ),
              _OverlayIconButton(
                icon: Icons.tune,
                tooltip: 'Sync sous-titres',
                onTap: () {
                  _show();
                  widget.onOpenSubtitleSync();
                },
              ),
              _OverlayIconButton(
                icon: widget.isLoadingSources ? null : Icons.hub_outlined,
                loading: widget.isLoadingSources,
                tooltip: 'Sources (${widget.sourcesCount})',
                onTap: () {
                  _show();
                  widget.onOpenSources();
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBottomBar(
    VideoPlayerState ps,
    double seekValue,
    Duration displayPosition,
  ) {
    final hasDuration = ps.duration > Duration.zero;

    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.bottomCenter,
          end: Alignment.topCenter,
          colors: [Color(0xCC000000), Colors.transparent],
        ),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 24, 8, 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Seek bar + temps
              Row(
                children: [
                  // Temps courant
                  Text(
                    _fmt(displayPosition),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      shadows: [Shadow(color: Colors.black54, blurRadius: 4)],
                    ),
                  ),
                  // Slider
                  Expanded(
                    child: SliderTheme(
                      data: SliderTheme.of(context).copyWith(
                        activeTrackColor: AppColors.primary,
                        inactiveTrackColor: Colors.white24,
                        thumbColor: Colors.white,
                        thumbShape: const RoundSliderThumbShape(
                          enabledThumbRadius: 6,
                        ),
                        overlayShape: SliderComponentShape.noOverlay,
                        trackHeight: 3,
                      ),
                      child: Slider(
                        value: seekValue,
                        onChanged: hasDuration
                            ? (v) {
                                setState(() => _seekDragValue = v);
                                _hideTimer?.cancel();
                              }
                            : null,
                        onChangeEnd: hasDuration
                            ? (v) {
                                final pos = Duration(
                                    milliseconds:
                                        (v * ps.duration.inMilliseconds)
                                            .round());
                                widget.onSeek(pos);
                                setState(() => _seekDragValue = null);
                                _scheduleHide();
                              }
                            : null,
                      ),
                    ),
                  ),
                  // Durée totale
                  Text(
                    _fmt(ps.duration),
                    style: const TextStyle(
                      color: Colors.white60,
                      fontSize: 12,
                      shadows: [Shadow(color: Colors.black54, blurRadius: 4)],
                    ),
                  ),
                ],
              ),

              // Boutons de contrôle
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  // Épisode précédent
                  _OverlayIconButton(
                    icon: Icons.skip_previous_rounded,
                    tooltip: 'Épisode précédent',
                    enabled: widget.canGoPrev,
                    size: 28,
                    onTap: widget.onPreviousEpisode != null
                        ? () {
                            _show();
                            widget.onPreviousEpisode!();
                          }
                        : null,
                  ),

                  // Reculer 15s
                  _OverlayIconButton(
                    icon: Icons.fast_rewind_rounded,
                    tooltip: '-15s',
                    size: 30,
                    onTap: () {
                      _show();
                      widget.onSeekBackward();
                    },
                  ),

                  // Play / Pause (bouton central prominent)
                  GestureDetector(
                    onTap: () {
                      _show();
                      widget.onTogglePlayPause();
                    },
                    child: Container(
                      width: 56,
                      height: 56,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.15),
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white38, width: 1.5),
                      ),
                      child: Icon(
                        ps.isPlaying
                            ? Icons.pause_rounded
                            : Icons.play_arrow_rounded,
                        color: Colors.white,
                        size: 34,
                      ),
                    ),
                  ),

                  // Avancer 15s
                  _OverlayIconButton(
                    icon: Icons.fast_forward_rounded,
                    tooltip: '+15s',
                    size: 30,
                    onTap: () {
                      _show();
                      widget.onSeekForward();
                    },
                  ),

                  // Épisode suivant
                  _OverlayIconButton(
                    icon: Icons.skip_next_rounded,
                    tooltip: 'Épisode suivant',
                    enabled: widget.canGoNext,
                    size: 28,
                    onTap: widget.onNextEpisode != null
                        ? () {
                            _show();
                            widget.onNextEpisode!();
                          }
                        : null,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// =============================================================================
// Bouton icône de l'overlay
// =============================================================================

class _OverlayIconButton extends StatelessWidget {
  final IconData? icon;
  final String tooltip;
  final VoidCallback? onTap;
  final bool enabled;
  final bool loading;
  final double size;

  const _OverlayIconButton({
    this.icon,
    required this.tooltip,
    this.onTap,
    this.enabled = true,
    this.loading = false,
    this.size = 24,
  });

  @override
  Widget build(BuildContext context) {
    final isActive = enabled && onTap != null && !loading;
    return Tooltip(
      message: tooltip,
      child: GestureDetector(
        onTap: isActive ? onTap : null,
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: loading
              ? SizedBox(
                  width: size,
                  height: size,
                  child: const CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              : Icon(
                  icon,
                  color: isActive ? Colors.white : Colors.white38,
                  size: size,
                  shadows: const [Shadow(color: Colors.black54, blurRadius: 6)],
                ),
        ),
      ),
    );
  }
}

// =============================================================================
// Bouton "Passer l'intro"
// =============================================================================

class _SkipIntroButton extends StatelessWidget {
  final VoidCallback onTap;
  const _SkipIntroButton({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.sm,
        ),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.6),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: Colors.white54),
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              "Passer l'intro",
              style: TextStyle(
                color: Colors.white,
                fontSize: 14,
                fontWeight: FontWeight.w500,
              ),
            ),
            SizedBox(width: 6),
            Icon(Icons.skip_next_rounded, color: Colors.white, size: 18),
          ],
        ),
      ),
    );
  }
}

// =============================================================================
// Card épisode suivant
// =============================================================================

class _AutoNextCard extends StatelessWidget {
  final int remainingSeconds;
  final VoidCallback onCancel;
  final Future<void> Function() onPlayNow;

  const _AutoNextCard({
    required this.remainingSeconds,
    required this.onCancel,
    required this.onPlayNow,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.85),
        borderRadius: BorderRadius.circular(AppTheme.borderRadius),
        border: Border.all(color: Colors.white24),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Countdown visuel en arc
          SizedBox(
            width: 36,
            height: 36,
            child: Stack(
              alignment: Alignment.center,
              children: [
                CircularProgressIndicator(
                  value: remainingSeconds /
                      _PlayerScreenState._autoNextDelaySeconds,
                  strokeWidth: 2.5,
                  backgroundColor: Colors.white24,
                  color: AppColors.primary,
                ),
                Text(
                  '$remainingSeconds',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          const Text(
            'Épisode suivant',
            style: TextStyle(
              color: Colors.white,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          TextButton(
            onPressed: onCancel,
            style: TextButton.styleFrom(
              foregroundColor: Colors.white70,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text('Annuler', style: TextStyle(fontSize: 13)),
          ),
          const SizedBox(width: 4),
          ElevatedButton(
            onPressed: onPlayNow,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
              ),
            ),
            child: const Text('Lire', style: TextStyle(fontSize: 13)),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// Sheet générique (sources, audio, sous-titres)
// =============================================================================

class _SelectorSheet extends StatelessWidget {
  final String title;
  final Widget child;

  const _SelectorSheet({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    return SafeArea(
      child: SizedBox(
        height: media.size.height * 0.78,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md, AppSpacing.md, AppSpacing.sm, AppSpacing.sm),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close, color: AppColors.textPrimary),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(child: child),
          ],
        ),
      ),
    );
  }
}

// =============================================================================
// Décalage sous-titres multi-niveaux
// =============================================================================

class _SubtitleDelayRow extends StatelessWidget {
  final int delayMs;
  final void Function(int delta) onStep;
  final VoidCallback onReset;

  const _SubtitleDelayRow({
    required this.delayMs,
    required this.onStep,
    required this.onReset,
  });

  String _formatDelay(int ms) {
    final sign = ms >= 0 ? '+' : '-';
    final abs = ms.abs();
    if (abs >= 60000) {
      final minutes = abs ~/ 60000;
      final seconds = (abs % 60000) ~/ 1000;
      final millis = abs % 1000;
      if (millis == 0) {
        return '$sign${minutes}m${seconds.toString().padLeft(2, '0')}s';
      }
    }
    if (abs >= 1000) {
      final s = (abs / 1000).toStringAsFixed(abs % 100 == 0 ? 1 : 3);
      return '$sign${s}s';
    }
    return '$sign${abs}ms';
  }

  Widget _stepBtn(String label, int delta, {double fontSize = 12}) {
    return Expanded(
      child: InkWell(
        onTap: () => onStep(delta),
        borderRadius: BorderRadius.circular(6),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: fontSize,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppSpacing.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text('Décalage sous-titres',
                    style: TextStyle(
                        color: AppColors.textPrimary,
                        fontWeight: FontWeight.w600)),
              ),
              Text(_formatDelay(delayMs),
                  style: const TextStyle(
                      color: AppColors.primary,
                      fontWeight: FontWeight.w700,
                      fontSize: 16)),
              const SizedBox(width: 8),
              GestureDetector(
                onTap: onReset,
                child: const Icon(Icons.restart_alt,
                    size: 18, color: AppColors.textSecondary),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              _stepBtn('-10m', -600000),
              _stepBtn('-1m', -60000),
              _stepBtn('-10s', -10000),
              const SizedBox(width: 4),
              _stepBtn('+10s', 10000),
              _stepBtn('+1m', 60000),
              _stepBtn('+10m', 600000),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              _stepBtn('-5s', -5000),
              _stepBtn('-1s', -1000),
              _stepBtn('-200ms', -200),
              const SizedBox(width: 4),
              _stepBtn('+200ms', 200),
              _stepBtn('+1s', 1000),
              _stepBtn('+5s', 5000),
              _stepBtn('+60s', 60000),
            ],
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// Stepper pour la sync ST
// =============================================================================

class _SyncStepperRow extends StatelessWidget {
  final String label;
  final String hint;
  final String value;
  final VoidCallback onMinus;
  final VoidCallback onPlus;

  const _SyncStepperRow({
    required this.label,
    required this.hint,
    required this.value,
    required this.onMinus,
    required this.onPlus,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppSpacing.sm),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text('$value $hint',
                    style: const TextStyle(color: AppColors.textSecondary)),
              ],
            ),
          ),
          IconButton(
            onPressed: onMinus,
            icon: const Icon(Icons.remove_circle_outline),
            color: AppColors.textPrimary,
          ),
          IconButton(
            onPressed: onPlus,
            icon: const Icon(Icons.add_circle_outline),
            color: AppColors.textPrimary,
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// Data classes internes
// =============================================================================

class _SourceProbeResult {
  final bool ok;
  final String? selectedSourceKey;

  const _SourceProbeResult({required this.ok, this.selectedSourceKey});
}

class _AudioSelectionData {
  final List<PlayerTrack> tracks;
  final PlayerTrack? activeTrack;
  final Map<int, String> labelsByTrackId;

  const _AudioSelectionData({
    required this.tracks,
    required this.activeTrack,
    required this.labelsByTrackId,
  });
}

enum _SubtitleChoiceKind { disable, embedded, openSubtitle }

class _SubtitleChoice {
  final _SubtitleChoiceKind kind;
  final PlayerTrack? embeddedTrack;
  final SubtitleEntry? openSubtitle;

  const _SubtitleChoice._({
    required this.kind,
    this.embeddedTrack,
    this.openSubtitle,
  });

  const _SubtitleChoice.disable() : this._(kind: _SubtitleChoiceKind.disable);

  const _SubtitleChoice.embedded(PlayerTrack track)
      : this._(kind: _SubtitleChoiceKind.embedded, embeddedTrack: track);

  const _SubtitleChoice.openSubtitle(SubtitleEntry entry)
      : this._(kind: _SubtitleChoiceKind.openSubtitle, openSubtitle: entry);
}
