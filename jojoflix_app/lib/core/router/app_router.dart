import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import '../auth/auth_state_provider.dart';
import '../../features/auth/widget/login_screen.dart';
import '../../features/profiles/widget/profiles_screen.dart';
import '../../features/home/widget/main_scaffold.dart';
import '../../features/home/widget/home_screen.dart';
import '../../features/browse/widget/browse_screen.dart';
import '../../features/search/widget/search_screen.dart';
import '../../features/detail/widget/detail_screen.dart';
import '../../features/detail/widget/person_screen.dart';
import '../../features/player/widget/player_overlay.dart';
import '../../features/profiles/widget/profile_screen.dart';
import '../../features/download/downloads_screen.dart';
import '../network/api_client.dart';

part 'app_router.g.dart';

class AppRoutes {
  static const String splash = '/';
  static const String login = '/login';
  static const String profileSelect = '/profiles/select';
  static const String profiles = '/profiles';
  static const String home = '/home';
  static const String browseMovies = '/browse/movie';
  static const String browseTv = '/browse/tv';
  static const String search = '/search';
  static const String detail = '/detail/:mediaType/:tmdbId';
  static const String person = '/person/:personId';
  static const String player = '/player/:mediaType/:tmdbId';
  static const String downloads = '/downloads';
}

@riverpod
GoRouter appRouter(Ref ref) {
  // Écouter l'état d'auth pour rafraîchir le router quand il change
  final isAuthenticated = ref.watch(authStateProvider);
  final prefs = ref.watch(sharedPreferencesProvider);

  return GoRouter(
    initialLocation: AppRoutes.splash,
    debugLogDiagnostics: false,
    redirect: (context, state) async {
      final location = state.matchedLocation;
      final activeProfileId = prefs.getString('active_profile_id');
      final hasActiveProfile = (activeProfileId ?? '').trim().isNotEmpty &&
          !isLegacyProfileId(activeProfileId);

      // Routes publiques (pas besoin d'être connecté)
      final publicRoutes = [AppRoutes.splash, AppRoutes.login];
      final isPublic = publicRoutes.contains(location);

      if (!isAuthenticated && !isPublic) {
        return AppRoutes.login;
      }

      if (isAuthenticated &&
          (location == AppRoutes.login || location == AppRoutes.splash)) {
        return hasActiveProfile ? AppRoutes.home : AppRoutes.profileSelect;
      }

      if (!isPublic &&
          location != AppRoutes.profileSelect &&
          isAuthenticated &&
          !hasActiveProfile) {
        return AppRoutes.profileSelect;
      }

      return null;
    },
    routes: [
      // Splash — vérifie le token et redirige
      GoRoute(
        path: AppRoutes.splash,
        builder: (context, state) => const _SplashScreen(),
      ),

      GoRoute(
        path: AppRoutes.login,
        builder: (context, state) => const LoginScreen(),
      ),

      GoRoute(
        path: AppRoutes.profileSelect,
        builder: (context, state) => const ProfilesScreen(),
      ),

      // Shell avec NavigationBar/Rail (toutes les pages sauf player)
      ShellRoute(
        builder: (context, state, child) {
          final location = state.matchedLocation;
          int selectedIndex = 0;
          if (location.startsWith('/browse/movie')) selectedIndex = 1;
          if (location.startsWith('/browse/tv')) selectedIndex = 2;
          if (location.startsWith('/search')) selectedIndex = 3;
          if (location.startsWith('/downloads')) selectedIndex = 4;
          if (location.startsWith('/profiles')) selectedIndex = 5;
          // detail et person n'activent aucun onglet
          if (location.startsWith('/detail') ||
              location.startsWith('/person')) {
            selectedIndex = -1;
          }

          return MainScaffold(selectedIndex: selectedIndex, child: child);
        },
        routes: [
          GoRoute(
            path: AppRoutes.home,
            builder: (context, state) => const HomeScreen(),
          ),
          GoRoute(
            path: AppRoutes.browseMovies,
            builder: (context, state) => const BrowseScreen(mediaType: 'movie'),
          ),
          GoRoute(
            path: AppRoutes.browseTv,
            builder: (context, state) => const BrowseScreen(mediaType: 'tv'),
          ),
          GoRoute(
            path: AppRoutes.search,
            builder: (context, state) => const SearchScreen(),
          ),
          GoRoute(
            path: AppRoutes.downloads,
            builder: (context, state) => const DownloadsScreen(),
          ),
          GoRoute(
            path: AppRoutes.profiles,
            builder: (context, state) => const ProfileScreen(),
          ),
          GoRoute(
            path: AppRoutes.detail,
            builder: (context, state) {
              final tmdbId = state.pathParameters['tmdbId']!;
              final mediaType = state.pathParameters['mediaType']!;
              return DetailScreen(tmdbId: tmdbId, mediaType: mediaType);
            },
          ),
          GoRoute(
            path: AppRoutes.person,
            builder: (context, state) {
              final personId =
                  int.tryParse(state.pathParameters['personId'] ?? '') ?? 0;
              return PersonScreen(personId: personId);
            },
          ),
        ],
      ),

      GoRoute(
        path: AppRoutes.player,
        builder: (context, state) {
          final tmdbId = state.pathParameters['tmdbId']!;
          final mediaType = state.pathParameters['mediaType']!;
          final extra = state.extra as Map<String, dynamic>? ?? {};
          final query = state.uri.queryParameters;

          int? readInt(String key) {
            final fromQuery = int.tryParse(query[key] ?? '');
            if (fromQuery != null) return fromQuery;

            final value = extra[key];
            if (value is int) return value;
            if (value is num) return value.toInt();
            if (value is String) return int.tryParse(value);
            return null;
          }

          String readProfileId() {
            final fromQuery = query['profileId'];
            if (fromQuery != null && fromQuery.isNotEmpty) return fromQuery;
            final value = extra['profileId'];
            if (value is String && value.isNotEmpty) return value;
            return '';
          }

          return PlayerScreen(
            tmdbId: tmdbId,
            mediaType: mediaType,
            profileId: readProfileId(),
            season: readInt('season'),
            episode: readInt('episode'),
            startPosition: readInt('startPosition') ?? 0,
            title: extra['title'] as String?,
            subtitle: extra['subtitle'] as String?,
            artworkUrl: extra['artworkUrl'] as String?,
            localVideoPath: extra['localVideoPath'] as String?,
            localSubtitles: (extra['localSubtitles'] as List?)
                    ?.whereType<Map>()
                    .map((item) => Map<String, dynamic>.from(item))
                    .toList(growable: false) ??
                const [],
          );
        },
      ),
    ],
  );
}

/// SplashScreen : affiche le logo pendant la vérification du token,
/// puis go_router redirect prend le relais automatiquement.
class _SplashScreen extends ConsumerWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isAuthenticated = ref.watch(authStateProvider);
    final prefs = ref.watch(sharedPreferencesProvider);
    final activeProfileId = prefs.getString('active_profile_id');
    final hasActiveProfile = (activeProfileId ?? '').trim().isNotEmpty &&
        !isLegacyProfileId(activeProfileId);

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (context.mounted) {
        context.go(
          isAuthenticated
              ? (hasActiveProfile ? AppRoutes.home : AppRoutes.profileSelect)
              : AppRoutes.login,
        );
      }
    });

    return const Scaffold(
      backgroundColor: Color(0xFF141414),
      body: Center(
        child: Text(
          'JOJOFLIX',
          style: TextStyle(
            fontSize: 36,
            fontWeight: FontWeight.w900,
            color: Color(0xFFE50914),
            letterSpacing: 4,
          ),
        ),
      ),
    );
  }
}
// Router
