import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import '../../../core/network/api_client.dart';

part 'auth_repository.g.dart';

@riverpod
AuthRepository authRepository(Ref ref) {
  return AuthRepository(apiClient: ref.watch(apiClientProvider));
}

class AuthRepository {
  final ApiClient apiClient;
  AuthRepository({required this.apiClient});

  Future<Map<String, dynamic>> login(String email, String password) async {
    final response = await apiClient.dio.post('/api/auth/login', data: {
      'email': email,
      'password': password,
    });
    final data = response.data['data'] as Map<String, dynamic>;
    await apiClient.saveToken(data['token'] as String);
    return data;
  }

  Future<Map<String, dynamic>> register(String email, String password) async {
    final response = await apiClient.dio.post('/api/auth/register', data: {
      'email': email,
      'password': password,
      'passwordConfirmation': password,
      'fullName': null,
    });
    final data = response.data['data'] as Map<String, dynamic>;
    await apiClient.saveToken(data['token'] as String);
    return data;
  }

  Future<void> logout() async {
    try {
      await apiClient.dio.post('/api/auth/logout');
    } on DioException {
      // Token déjà révoqué — on continue le logout local
    } finally {
      await apiClient.clearSession();
    }
  }
}
