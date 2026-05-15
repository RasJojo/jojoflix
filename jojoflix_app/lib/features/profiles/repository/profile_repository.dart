import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import '../../../core/network/api_client.dart';

part 'profile_repository.g.dart';

@riverpod
ProfileRepository profileRepository(Ref ref) {
  return ProfileRepository(apiClient: ref.watch(apiClientProvider));
}

class ProfileModel {
  final int id;
  final String name;
  final String? avatarUrl;
  final bool isKids;
  final Map<String, dynamic> preferences;

  const ProfileModel({
    required this.id,
    required this.name,
    this.avatarUrl,
    required this.isKids,
    required this.preferences,
  });

  factory ProfileModel.fromJson(Map<String, dynamic> json) {
    return ProfileModel(
      id: json['id'] as int,
      name: json['name'] as String,
      avatarUrl: json['avatar_url'] as String?,
      isKids: json['is_kids'] as bool? ?? false,
      preferences: json['preferences'] as Map<String, dynamic>? ?? {},
    );
  }
}

class ProfileRepository {
  final ApiClient apiClient;
  ProfileRepository({required this.apiClient});

  Future<List<ProfileModel>> getProfiles() async {
    final response = await apiClient.dio.get('/api/profiles');
    final data = response.data['data'] as List;
    return data.map((json) => ProfileModel.fromJson(json as Map<String, dynamic>)).toList();
  }

  Future<ProfileModel> createProfile(String name, {bool isKids = false}) async {
    final response = await apiClient.dio.post('/api/profiles', data: {
      'name': name,
      'is_kids': isKids,
    });
    return ProfileModel.fromJson(response.data['data'] as Map<String, dynamic>);
  }

  Future<Map<String, dynamic>> selectProfile(int profileId) async {
    final response = await apiClient.dio.post('/api/profiles/$profileId/select');
    final data = response.data['data'] as Map<String, dynamic>;
    await apiClient.saveProfileId(profileId.toString());
    return data;
  }

  Future<void> updatePreferences(int profileId, Map<String, dynamic> preferences) async {
    await apiClient.dio.put('/api/profiles/$profileId', data: {
      'preferences': preferences,
    });
  }
}
