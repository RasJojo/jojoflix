import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import '../../../core/network/api_client.dart';

part 'subtitle_repository.g.dart';

@riverpod
SubtitleRepository subtitleRepository(Ref ref) {
  return SubtitleRepository(apiClient: ref.watch(apiClientProvider));
}

class SubtitleEntry {
  final String fileId;
  final String language;
  final String releaseName;
  final bool hearingImpaired;

  const SubtitleEntry({
    required this.fileId,
    required this.language,
    required this.releaseName,
    required this.hearingImpaired,
  });

  factory SubtitleEntry.fromJson(Map<String, dynamic> json) {
    return SubtitleEntry(
      fileId: json['file_id'].toString(),
      language: json['language'] as String,
      releaseName: json['release_name'] as String? ?? '',
      hearingImpaired: json['hearing_impaired'] as bool? ?? false,
    );
  }

  String get displayName {
    final lang = _humanLanguage(language);
    final hi = hearingImpaired ? ' [SME]' : '';
    return '$lang$hi';
  }

  static String _humanLanguage(String code) {
    const map = {
      'fr': 'Français',
      'french': 'Français',
      'en': 'Anglais',
      'english': 'Anglais',
      'es': 'Espagnol',
      'spanish': 'Espagnol',
      'de': 'Allemand',
      'german': 'Allemand',
      'it': 'Italien',
      'italian': 'Italien',
      'pt': 'Portugais',
      'portuguese': 'Portugais',
      'pt-pt': 'Portugais',
      'pt-br': 'Portugais (Brésil)',
      'ar': 'Arabe',
      'arabic': 'Arabe',
      'ja': 'Japonais',
      'japanese': 'Japonais',
      'ru': 'Russe',
      'russian': 'Russe',
      'tr': 'Turc',
      'turkish': 'Turc',
      'nl': 'Néerlandais',
      'dutch': 'Néerlandais',
      'pl': 'Polonais',
      'polish': 'Polonais',
      'sv': 'Suédois',
      'swedish': 'Suédois',
      'da': 'Danois',
      'danish': 'Danois',
      'no': 'Norvégien',
      'norwegian': 'Norvégien',
      'fi': 'Finnois',
      'finnish': 'Finnois',
      'hu': 'Hongrois',
      'hungarian': 'Hongrois',
      'cs': 'Tchèque',
      'czech': 'Tchèque',
      'ro': 'Roumain',
      'romanian': 'Roumain',
      'uk': 'Ukrainien',
      'ukrainian': 'Ukrainien',
      'zh': 'Chinois',
      'chinese': 'Chinois',
      'zh-cn': 'Chinois (simplifié)',
      'zh-tw': 'Chinois (traditionnel)',
      'ko': 'Coréen',
      'korean': 'Coréen',
      'he': 'Hébreu',
      'el': 'Grec',
      'und': 'Inconnu',
    };
    final normalized = code.toLowerCase().trim();
    return map[normalized] ?? normalized.toUpperCase();
  }
}

class MediaMarker {
  final String type;
  final int startTime;
  final int endTime;

  const MediaMarker({
    required this.type,
    required this.startTime,
    required this.endTime,
  });

  factory MediaMarker.fromJson(Map<String, dynamic> json) {
    return MediaMarker(
      type: (json['type'] as String? ?? '').toLowerCase(),
      startTime: (json['start_time'] as num?)?.toInt() ?? 0,
      endTime: (json['end_time'] as num?)?.toInt() ?? 0,
    );
  }
}

class SubtitleRepository {
  final ApiClient apiClient;
  SubtitleRepository({required this.apiClient});

  Future<List<SubtitleEntry>> listSubtitles(
    String tmdbId, {
    int? season,
    int? episode,
  }) async {
    final params = <String, dynamic>{};
    if (season != null) params['season'] = season;
    if (episode != null) params['episode'] = episode;

    final response = await apiClient.dio.get(
      '/api/subtitles/list/$tmdbId',
      queryParameters: params,
    );
    final data = response.data['data'] as List? ?? [];
    return data
        .cast<Map<String, dynamic>>()
        .map(SubtitleEntry.fromJson)
        .toList();
  }

  /// Retourne l'URL proxy /api/subtitles/vtt/:id à passer au player.
  Future<String> downloadSubtitle(
    String fileId,
    String language, {
    Duration timeout = const Duration(seconds: 45),
  }) async {
    final response = await apiClient.dio.post(
      '/api/subtitles/download',
      data: {
        'file_id': fileId,
        'language': language,
      },
      options: Options(
        sendTimeout: const Duration(seconds: 10),
        receiveTimeout: timeout,
      ),
    );
    final proxyUrl = response.data['data']['proxy_url'] as String;
    if (proxyUrl.startsWith('http://') || proxyUrl.startsWith('https://')) {
      return proxyUrl;
    }
    return Uri.parse(apiClient.dio.options.baseUrl)
        .resolve(proxyUrl)
        .toString();
  }

  Future<List<MediaMarker>> getMarkers(String tmdbId) async {
    final response = await apiClient.dio.get('/api/subtitles/markers/$tmdbId');
    final data = response.data['data'] as List? ?? [];
    return data.cast<Map<String, dynamic>>().map(MediaMarker.fromJson).toList();
  }
}
// Subs
