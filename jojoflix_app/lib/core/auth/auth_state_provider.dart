import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import '../network/api_client.dart';

part 'auth_state_provider.g.dart';

/// Lit le token dans le storage.
/// null = pas encore vérifié, true = connecté, false = déconnecté.
@riverpod
bool authState(Ref ref) {
  final prefs = ref.watch(sharedPreferencesProvider);
  final token = prefs.getString('auth_token');
  return token != null && token.isNotEmpty;
}

/// Permet d'invalider l'état d'auth depuis n'importe quel endroit
/// (après login, logout, erreur 401).
extension AuthStateInvalidation on WidgetRef {
  void invalidateAuth() => invalidate(authStateProvider);
}

extension AuthStateInvalidationRef on Ref {
  void invalidateAuth() => invalidate(authStateProvider);
}
