import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import '../../../core/network/api_client.dart';

part 'transcode_repository.g.dart';

@riverpod
TranscodeRepository transcodeRepository(Ref ref) {
  return TranscodeRepository(apiClient: ref.watch(apiClientProvider));
}

class AudioTrackInfo {
  final int index;
  final int streamIndex;
  final String? language;
  final String? title;
  final String codec;
  final int channels;

  const AudioTrackInfo({
    required this.index,
    required this.streamIndex,
    this.language,
    this.title,
    required this.codec,
    required this.channels,
  });

  factory AudioTrackInfo.fromJson(Map<String, dynamic> json) {
    return AudioTrackInfo(
      index: json['index'] as int,
      streamIndex: json['stream_index'] as int,
      language: json['language'] as String?,
      title: json['title'] as String?,
      codec: json['codec'] as String,
      channels: json['channels'] as int,
    );
  }

  String get displayName {
    if (title != null && title!.isNotEmpty) return title!;
    if (language != null && language!.isNotEmpty) return _langName(language!);
    return 'Piste ${index + 1}';
  }

  static String _langName(String code) {
    const map = {
      'fr': 'Français',
      'fra': 'Français',
      'fre': 'Français',
      'french': 'Français',
      'en': 'Anglais',
      'eng': 'Anglais',
      'english': 'Anglais',
      'es': 'Espagnol',
      'spa': 'Espagnol',
      'de': 'Allemand',
      'deu': 'Allemand',
      'ger': 'Allemand',
      'german': 'Allemand',
      'it': 'Italien',
      'ita': 'Italien',
      'pt': 'Portugais',
      'por': 'Portugais',
      'ja': 'Japonais',
      'jpn': 'Japonais',
      'ko': 'Coréen',
      'kor': 'Coréen',
      'zh': 'Chinois',
      'chi': 'Chinois',
      'zho': 'Chinois',
      'ar': 'Arabe',
      'ara': 'Arabe',
      'ru': 'Russe',
      'rus': 'Russe',
    };
    return map[code.toLowerCase()] ?? code.toUpperCase();
  }
}

class SubtitleTrackInfo {
  final int index;
  final int streamIndex;
  final String? language;
  final String? title;
  final String codec;
  final bool isForced;
  final bool isDefault;

  const SubtitleTrackInfo({
    required this.index,
    required this.streamIndex,
    this.language,
    this.title,
    required this.codec,
    required this.isForced,
    required this.isDefault,
  });

  factory SubtitleTrackInfo.fromJson(Map<String, dynamic> json) {
    return SubtitleTrackInfo(
      index: json['index'] as int,
      streamIndex: json['stream_index'] as int,
      language: json['language'] as String?,
      title: json['title'] as String?,
      codec: json['codec'] as String? ?? '',
      isForced: json['forced'] as bool? ?? false,
      isDefault: json['default'] as bool? ?? false,
    );
  }

  String get displayName {
    final label = (title != null && title!.trim().isNotEmpty)
        ? title!.trim()
        : language != null && language!.trim().isNotEmpty
            ? AudioTrackInfo._langName(language!)
            : 'Sous-titre ${index + 1}';
    final tags = <String>[
      if (isDefault) 'Defaut',
      if (isForced) 'Force',
      if (codec.trim().isNotEmpty) codec.trim().toUpperCase(),
    ];
    if (tags.isEmpty) return label;
    return '$label • ${tags.join(' • ')}';
  }
}

class MediaInfo {
  final double? durationSeconds;
  final List<AudioTrackInfo> audioTracks;
  final List<SubtitleTrackInfo> subtitleTracks;

  const MediaInfo({
    required this.durationSeconds,
    required this.audioTracks,
    required this.subtitleTracks,
  });

  factory MediaInfo.fromJson(Map<String, dynamic> json) {
    final audio = (json['audio_tracks'] as List? ?? const [])
        .cast<Map<String, dynamic>>()
        .map(AudioTrackInfo.fromJson)
        .toList(growable: false);
    final subtitles = (json['subtitle_tracks'] as List? ?? const [])
        .cast<Map<String, dynamic>>()
        .map(SubtitleTrackInfo.fromJson)
        .toList(growable: false);
    return MediaInfo(
      durationSeconds: (json['duration_seconds'] as num?)?.toDouble(),
      audioTracks: audio,
      subtitleTracks: subtitles,
    );
  }
}

class TranscodeRepository {
  final ApiClient apiClient;
  TranscodeRepository({required this.apiClient});

  Future<MediaInfo> getMediaInfo({String? streamId}) async {
    final query = <String, dynamic>{};
    if (streamId != null && streamId.isNotEmpty) {
      query['stream_id'] = streamId;
    }
    final response =
        await apiClient.dio.get('/api/transcode/info', queryParameters: query);
    final data = response.data['data'] as Map<String, dynamic>? ?? const {};
    return MediaInfo.fromJson(data);
  }

  Future<List<AudioTrackInfo>> getAudioTracks({String? streamId}) async {
    final info = await getMediaInfo(streamId: streamId);
    return info.audioTracks;
  }

  /// Retourne l'URL absolue du stream transcoder avec la piste audio sélectionnée.
  /// Le player doit recharger cette URL (avec le token Bearer en header).
  String getTranscodeAudioPath(int trackIndex, {String? streamId}) {
    final query = <String, dynamic>{'track': trackIndex};
    if (streamId != null && streamId.isNotEmpty) {
      query['stream_id'] = streamId;
    }
    return Uri(path: '/api/transcode/audio', queryParameters: query).toString();
  }

  Future<String> getSubtitleTrackVtt(
    int trackIndex, {
    String? streamId,
    Duration timeout = const Duration(seconds: 160),
  }) async {
    final query = <String, dynamic>{'track': trackIndex};
    if (streamId != null && streamId.isNotEmpty) {
      query['stream_id'] = streamId;
    }
    final response = await apiClient.dio.get<String>(
      '/api/transcode/subtitle',
      queryParameters: query,
      options: Options(
        responseType: ResponseType.plain,
        sendTimeout: timeout,
        receiveTimeout: timeout,
      ),
    );
    return response.data ?? '';
  }
}
