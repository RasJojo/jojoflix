import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import '../../../core/network/api_client.dart';

part 'home_repository.g.dart';

@riverpod
HomeRepository homeRepository(Ref ref) {
  return HomeRepository(apiClient: ref.watch(apiClientProvider));
}

class HomeRow {
  final String type;
  final String title;
  final List<HomeItem> items;

  const HomeRow({required this.type, required this.title, required this.items});

  factory HomeRow.fromJson(Map<String, dynamic> json) {
    return HomeRow(
      type: json['type'] as String,
      title: json['title'] as String,
      items: (json['items'] as List)
          .map((i) => HomeItem.fromJson(i as Map<String, dynamic>))
          .toList(),
    );
  }
}

class HomeItem {
  final String tmdbId;
  final String title;
  final String mediaType;
  final String? posterUrl;
  final String? backdropUrl;
  final int? currentTime;
  final int? totalDuration;
  final double? progress;
  final int? seasonNum;
  final int? episodeNum;

  const HomeItem({
    required this.tmdbId,
    required this.title,
    required this.mediaType,
    this.posterUrl,
    this.backdropUrl,
    this.currentTime,
    this.totalDuration,
    this.progress,
    this.seasonNum,
    this.episodeNum,
  });

  factory HomeItem.fromJson(Map<String, dynamic> json) {
    return HomeItem(
      tmdbId: json['tmdb_id'].toString(),
      title: json['title'] as String? ?? json['name'] as String? ?? '',
      mediaType: json['media_type'] as String? ?? 'movie',
      posterUrl: json['poster_url'] as String?,
      backdropUrl: json['backdrop_url'] as String?,
      currentTime: json['current_time'] as int?,
      totalDuration: json['total_duration'] as int?,
      progress: (json['progress'] as num?)?.toDouble(),
      seasonNum: (json['season_num'] as num?)?.toInt(),
      episodeNum: (json['episode_num'] as num?)?.toInt(),
    );
  }
}

class HomeRepository {
  final ApiClient apiClient;
  HomeRepository({required this.apiClient});

  Future<List<HomeRow>> getHomeRows(int profileId) async {
    final response = await apiClient.dio.get('/api/home/$profileId');
    final data = response.data['data']['rows'] as List;
    return data
        .map((r) => HomeRow.fromJson(r as Map<String, dynamic>))
        .toList();
  }
}
// Repos
