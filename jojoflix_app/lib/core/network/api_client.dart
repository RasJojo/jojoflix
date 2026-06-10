import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:shared_preferences/shared_preferences.dart';

part 'api_client.g.dart';

const String _envBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: '',
);
const String _hostedApiBaseUrl = 'https://jojoflixapi.jojoserv.com';

const String _tokenKey = 'auth_token';
const String _profileIdKey = 'active_profile_id';

bool isLegacyAuthToken(String? token) =>
    token != null && token.startsWith('oat_');

bool isLegacyProfileId(String? profileId) {
  if (profileId == null || profileId.trim().isEmpty) return false;
  return RegExp(r'^\d+$').hasMatch(profileId.trim());
}

Future<void> removeLegacySessionState(SharedPreferences prefs) async {
  if (isLegacyAuthToken(prefs.getString(_tokenKey))) {
    await prefs.remove(_tokenKey);
    await prefs.remove(_profileIdKey);
    return;
  }

  if (isLegacyProfileId(prefs.getString(_profileIdKey))) {
    await prefs.remove(_profileIdKey);
  }
}

// Overridé dans main() avec la valeur déjà initialisée
@Riverpod(keepAlive: true)
SharedPreferences sharedPreferences(Ref ref) {
  throw UnimplementedError();
}

@riverpod
ApiClient apiClient(Ref ref) {
  final prefs = ref.watch(sharedPreferencesProvider);
  return ApiClient(prefs: prefs);
}

class ApiClient {
  final SharedPreferences prefs;
  late final Dio _dio;

  ApiClient({required this.prefs}) {
    final resolvedBaseUrl = _resolveBaseUrl();

    _dio = Dio(
      BaseOptions(
        baseUrl: resolvedBaseUrl,
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 30),
        headers: {'Content-Type': 'application/json'},
      ),
    );

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = prefs.getString(_tokenKey);
          if (isLegacyAuthToken(token)) {
            await clearSession();
          } else if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          final profileId = prefs.getString(_profileIdKey);
          if (isLegacyProfileId(profileId)) {
            await prefs.remove(_profileIdKey);
          } else if (profileId != null) {
            options.headers['X-Profile-Id'] = profileId;
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          if (kDebugMode) {
            final statusCode = error.response?.statusCode;
            final backendMessage =
                _extractBackendMessage(error.response?.data) ?? 'n/a';
            // ignore: avoid_print
            print(
              '[ApiClient] ${error.requestOptions.method} '
              '${error.requestOptions.uri} -> ${statusCode ?? 'network'} '
              '| message=$backendMessage',
            );
          }

          if (error.type == DioExceptionType.connectionError ||
              error.type == DioExceptionType.connectionTimeout) {
            // ignore: avoid_print
            print(
              '[ApiClient] Connection error on ${error.requestOptions.uri}. '
              'API_BASE_URL=$resolvedBaseUrl',
            );
          }

          if (error.response?.statusCode == 401) {
            await prefs.remove(_tokenKey);
            await prefs.remove(_profileIdKey);
          }
          handler.next(error);
        },
      ),
    );
  }

  Dio get dio => _dio;

  Future<void> saveToken(String token) async {
    await prefs.setString(_tokenKey, token);
    await prefs.remove(_profileIdKey);
  }

  Future<void> saveProfileId(String profileId) async {
    await prefs.setString(_profileIdKey, profileId);
  }

  Future<void> clearSession() async {
    await prefs.remove(_tokenKey);
    await prefs.remove(_profileIdKey);
  }

  static String _resolveBaseUrl() {
    if (_envBaseUrl.isNotEmpty) {
      return _envBaseUrl;
    }

    // Production default: hosted API through Cloudflare tunnel.
    // Local dev can always override with --dart-define=API_BASE_URL=...
    return _hostedApiBaseUrl;
  }

  static String? _extractBackendMessage(dynamic data) {
    if (data is Map &&
        data['error'] is Map &&
        data['error']['message'] is String) {
      return data['error']['message'] as String;
    }
    return null;
  }
}
// API
