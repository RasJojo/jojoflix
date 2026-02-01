import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';

final personRepositoryProvider = Provider<PersonRepository>((ref) {
  return PersonRepository(apiClient: ref.watch(apiClientProvider));
});

final personDetailProvider =
    FutureProvider.family<PersonDetail, int>((ref, personId) async {
  return ref.watch(personRepositoryProvider).getDetail(personId);
});

class PersonCredit {
  final String tmdbId;
  final String mediaType;
  final String title;
  final String? overview;
  final String? posterUrl;
  final String? backdropUrl;
  final String? releaseDate;
  final String? character;

  const PersonCredit({
    required this.tmdbId,
    required this.mediaType,
    required this.title,
    this.overview,
    this.posterUrl,
    this.backdropUrl,
    this.releaseDate,
    this.character,
  });

  factory PersonCredit.fromJson(Map<String, dynamic> json) {
    return PersonCredit(
      tmdbId: json['tmdb_id'].toString(),
      mediaType: json['media_type'] as String? ?? 'movie',
      title: json['title'] as String? ?? json['name'] as String? ?? '',
      overview: json['overview'] as String?,
      posterUrl: json['poster_url'] as String?,
      backdropUrl: json['backdrop_url'] as String?,
      releaseDate: json['release_date'] as String?,
      character: json['character'] as String?,
    );
  }
}

class PersonDetail {
  final int personId;
  final String name;
  final String? biography;
  final String? birthday;
  final String? placeOfBirth;
  final String? knownForDepartment;
  final String? profileUrl;
  final List<PersonCredit> credits;

  const PersonDetail({
    required this.personId,
    required this.name,
    this.biography,
    this.birthday,
    this.placeOfBirth,
    this.knownForDepartment,
    this.profileUrl,
    this.credits = const [],
  });

  factory PersonDetail.fromJson(Map<String, dynamic> json) {
    return PersonDetail(
      personId: (json['person_id'] as num?)?.toInt() ?? 0,
      name: json['name'] as String? ?? '',
      biography: json['biography'] as String?,
      birthday: json['birthday'] as String?,
      placeOfBirth: json['place_of_birth'] as String?,
      knownForDepartment: json['known_for_department'] as String?,
      profileUrl: json['profile_url'] as String?,
      credits: (json['credits'] as List? ?? [])
          .map((item) => PersonCredit.fromJson(item as Map<String, dynamic>))
          .toList(),
    );
  }
}

class PersonRepository {
  final ApiClient apiClient;
  PersonRepository({required this.apiClient});

  Future<PersonDetail> getDetail(int personId) async {
    final response = await apiClient.dio.get('/api/people/$personId');
    return PersonDetail.fromJson(response.data['data'] as Map<String, dynamic>);
  }
}
