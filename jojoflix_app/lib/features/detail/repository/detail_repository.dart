import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import '../../../core/network/api_client.dart';

part 'detail_repository.g.dart';

@riverpod
DetailRepository detailRepository(Ref ref) {
  return DetailRepository(apiClient: ref.watch(apiClientProvider));
}

class MediaDetail {
  final String tmdbId;
  final String title;
  final String mediaType;
  final String? overview;
  final String? posterUrl;
  final String? backdropUrl;
  final String? releaseDate;
  final double? rating;
  final int? runtime; // minutes (movie) or null (tv)
  final List<Season> seasons; // empty for movies
  final List<CastMember> cast;

  const MediaDetail({
    required this.tmdbId,
    required this.title,
    required this.mediaType,
    this.overview,
    this.posterUrl,
    this.backdropUrl,
    this.releaseDate,
    this.rating,
    this.runtime,
    this.seasons = const [],
    this.cast = const [],
  });

  factory MediaDetail.fromJson(Map<String, dynamic> json) {
    final seasons = (json['seasons'] as List? ?? [])
        .map((s) => Season.fromJson(s as Map<String, dynamic>))
        .toList();
    final cast = (json['cast'] as List? ?? [])
        .map((c) => CastMember.fromJson(c as Map<String, dynamic>))
        .toList();
    return MediaDetail(
      tmdbId: json['tmdb_id'].toString(),
      title: json['title'] as String? ?? json['name'] as String? ?? '',
      mediaType: json['media_type'] as String? ?? 'movie',
      overview: json['overview'] as String?,
      posterUrl: json['poster_url'] as String?,
      backdropUrl: json['backdrop_url'] as String?,
      releaseDate: json['release_date'] as String?,
      rating: (json['rating'] as num?)?.toDouble(),
      runtime: json['runtime'] as int?,
      seasons: seasons,
      cast: cast,
    );
  }
}

class Season {
  final int seasonNumber;
  final String name;
  final List<Episode> episodes;

  const Season({
    required this.seasonNumber,
    required this.name,
    required this.episodes,
  });

  factory Season.fromJson(Map<String, dynamic> json) {
    return Season(
      seasonNumber: json['season_number'] as int,
      name: json['name'] as String? ?? 'Saison ${json['season_number']}',
      episodes: (json['episodes'] as List? ?? [])
          .map((e) => Episode.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}

class Episode {
  final int episodeNumber;
  final String name;
  final String? overview;
  final String? stillUrl;
  final int? runtime;
  final double? progress;

  const Episode({
    required this.episodeNumber,
    required this.name,
    this.overview,
    this.stillUrl,
    this.runtime,
    this.progress,
  });

  factory Episode.fromJson(Map<String, dynamic> json) {
    return Episode(
      episodeNumber: json['episode_number'] as int,
      name: json['name'] as String? ?? 'Épisode ${json['episode_number']}',
      overview: json['overview'] as String?,
      stillUrl: json['still_url'] as String?,
      runtime: json['runtime'] as int?,
      progress: (json['progress'] as num?)?.toDouble(),
    );
  }
}

class CastMember {
  final int? personId;
  final String name;
  final String? character;
  final String? profileUrl;

  const CastMember({
    this.personId,
    required this.name,
    this.character,
    this.profileUrl,
  });

  factory CastMember.fromJson(Map<String, dynamic> json) {
    return CastMember(
      personId: (json['person_id'] as num?)?.toInt(),
      name: json['name'] as String,
      character: json['character'] as String?,
      profileUrl: json['profile_url'] as String?,
    );
  }
}

class WatchProgress {
  final int? currentTime;
  final int? totalDuration;
  final double? progress;
  final int? lastSeason;
  final int? lastEpisode;

  const WatchProgress({
    this.currentTime,
    this.totalDuration,
    this.progress,
    this.lastSeason,
    this.lastEpisode,
  });

  factory WatchProgress.fromJson(Map<String, dynamic> json) {
    return WatchProgress(
      currentTime: json['current_time'] as int?,
      totalDuration: json['total_duration'] as int?,
      progress: (json['progress'] as num?)?.toDouble(),
      lastSeason: json['season'] as int?,
      lastEpisode: json['episode'] as int?,
    );
  }
}

class DetailRepository {
  final ApiClient apiClient;
  DetailRepository({required this.apiClient});

  Future<MediaDetail> getDetail(String tmdbId, String mediaType) async {
    final response = await apiClient.dio.get('/api/media/$mediaType/$tmdbId');
    return MediaDetail.fromJson(response.data['data'] as Map<String, dynamic>);
  }

  Future<WatchProgress?> getProgress(String tmdbId, String mediaType) async {
    try {
      final response =
          await apiClient.dio.get('/api/progress/$mediaType/$tmdbId');
      final data = response.data['data'];
      if (data == null) return null;
      return WatchProgress.fromJson(data as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }
}
