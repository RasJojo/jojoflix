import 'dart:async';

import 'package:flutter/material.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';
import 'package:youtube_explode_dart/youtube_explode_dart.dart' hide Video, VideoId;
import '../../../core/theme/app_theme.dart';
import '../../../core/widget/jojoflix_loader.dart';

class TrailerScreen extends StatefulWidget {
  final String trailerKey;
  final String title;

  const TrailerScreen({
    super.key,
    required this.trailerKey,
    required this.title,
  });

  @override
  State<TrailerScreen> createState() => _TrailerScreenState();
}

class _TrailerScreenState extends State<TrailerScreen> {
  late final Player _player;
  late final VideoController _controller;

  bool _loading = true;
  String? _error;
  bool _overlayVisible = true;
  Timer? _hideTimer;
  YoutubeExplode? _yt;

  bool _playing = false;
  Duration _position = Duration.zero;
  Duration _duration = Duration.zero;

  @override
  void initState() {
    super.initState();
    _player = Player();
    _controller = VideoController(_player);
    _player.stream.playing.listen((v) {
      if (!mounted) return;
      setState(() => _playing = v);
      if (v) _scheduleHide();
    });
    _player.stream.position.listen((v) {
      if (mounted) setState(() => _position = v);
    });
    _player.stream.duration.listen((v) {
      if (mounted) setState(() => _duration = v);
    });
    _loadTrailer();
  }

  Future<void> _loadTrailer() async {
    _yt = YoutubeExplode();
    try {
      // Essayer plusieurs clients YouTube (le client par défaut androidSdkless
      // est souvent bloqué pour les trailers officiels avec restriction d'âge)
      final manifest = await _yt!.videos.streamsClient.getManifest(
        widget.trailerKey,
        ytClients: [
          YoutubeApiClient.androidVr,
          YoutubeApiClient.tv,
          YoutubeApiClient.ios,
          YoutubeApiClient.android,
        ],
        requireWatchPage: false,
      );

      // Muxed en priorité (audio+vidéo intégrés), sinon erreur
      if (manifest.muxed.isEmpty) throw Exception('no_muxed_stream');
      final stream = manifest.muxed.withHighestBitrate();
      await _player.open(Media(stream.url.toString()));
      await _player.play();
      if (mounted) setState(() => _loading = false);
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Impossible de charger la bande annonce';
        });
      }
    }
    // _yt reste ouvert jusqu'au dispose() pour que les URLs restent valides
  }

  @override
  void dispose() {
    _hideTimer?.cancel();
    _yt?.close();
    _player.dispose();
    super.dispose();
  }

  void _scheduleHide() {
    _hideTimer?.cancel();
    _hideTimer = Timer(const Duration(seconds: 3), () {
      if (mounted && _playing) setState(() => _overlayVisible = false);
    });
  }

  void _onTap() {
    if (_overlayVisible) {
      _hideTimer?.cancel();
      setState(() => _overlayVisible = false);
    } else {
      setState(() => _overlayVisible = true);
      _scheduleHide();
    }
  }

  String _fmt(Duration d) {
    final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final progress = _duration.inMilliseconds > 0
        ? (_position.inMilliseconds / _duration.inMilliseconds).clamp(0.0, 1.0)
        : 0.0;

    return Scaffold(
      backgroundColor: Colors.black,
      body: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: _onTap,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (!_loading && _error == null)
              Video(
                controller: _controller,
                controls: NoVideoControls,
                fit: BoxFit.contain,
              ),

            if (_loading) const Center(child: JojoflixLoader()),

            if (_error != null)
              _ErrorView(
                message: _error!,
                onClose: () => Navigator.pop(context),
              ),

            if (!_loading && _error == null)
              AnimatedOpacity(
                opacity: _overlayVisible ? 1.0 : 0.0,
                duration: const Duration(milliseconds: 200),
                child: IgnorePointer(
                  ignoring: !_overlayVisible,
                  child: _TrailerOverlay(
                    title: widget.title,
                    playing: _playing,
                    position: _position,
                    duration: _duration,
                    progress: progress.toDouble(),
                    onClose: () => Navigator.pop(context),
                    onTogglePlay: () => _player.playOrPause(),
                    onSeek: (v) => _player.seek(
                      Duration(
                          milliseconds:
                              (v * _duration.inMilliseconds).round()),
                    ),
                    fmt: _fmt,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// =============================================================================

class _TrailerOverlay extends StatelessWidget {
  final String title;
  final bool playing;
  final Duration position;
  final Duration duration;
  final double progress;
  final VoidCallback onClose;
  final VoidCallback onTogglePlay;
  final ValueChanged<double> onSeek;
  final String Function(Duration) fmt;

  const _TrailerOverlay({
    required this.title,
    required this.playing,
    required this.position,
    required this.duration,
    required this.progress,
    required this.onClose,
    required this.onTogglePlay,
    required this.onSeek,
    required this.fmt,
  });

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        // Top gradient + titre + fermer
        Positioned(
          top: 0,
          left: 0,
          right: 0,
          child: Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Color(0xCC000000), Colors.transparent],
              ),
            ),
            child: SafeArea(
              bottom: false,
              child: Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.close, color: Colors.white),
                    onPressed: onClose,
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      '$title — Bande annonce',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),

        // Bouton play/pause centré
        Center(
          child: GestureDetector(
            onTap: onTogglePlay,
            child: Container(
              width: 64,
              height: 64,
              decoration: const BoxDecoration(
                color: Color(0x99000000),
                shape: BoxShape.circle,
              ),
              child: Icon(
                playing ? Icons.pause : Icons.play_arrow,
                color: Colors.white,
                size: 36,
              ),
            ),
          ),
        ),

        // Barre de progression + temps en bas
        Positioned(
          bottom: 0,
          left: 0,
          right: 0,
          child: Container(
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
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: Row(
                  children: [
                    Text(
                      fmt(position),
                      style: const TextStyle(
                          color: Colors.white70, fontSize: 12),
                    ),
                    Expanded(
                      child: Slider(
                        value: progress,
                        onChanged: onSeek,
                        activeColor: AppColors.primary,
                        inactiveColor: Colors.white24,
                      ),
                    ),
                    Text(
                      fmt(duration),
                      style: const TextStyle(
                          color: Colors.white70, fontSize: 12),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onClose;

  const _ErrorView({required this.message, required this.onClose});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.error_outline, color: Colors.white54, size: 48),
          const SizedBox(height: 16),
          Text(message,
              style: const TextStyle(color: Colors.white70),
              textAlign: TextAlign.center),
          const SizedBox(height: 24),
          TextButton(
            onPressed: onClose,
            child: const Text('Fermer',
                style: TextStyle(color: AppColors.primary)),
          ),
        ],
      ),
    );
  }
}
