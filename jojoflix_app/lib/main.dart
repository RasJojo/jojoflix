import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'core/auth/auth_state_provider.dart';

void main() {
  runApp(const ProviderScope(child: JojoflixApp()));
}

class JojoflixApp extends ConsumerWidget {
  const JojoflixApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final goRouter = ref.watch(appRouterProvider);
    
    return MaterialApp.router(
      title: 'JojoFlix',
      routerConfig: goRouter,
      theme: AppTheme.darkTheme,
      debugShowCheckedModeBanner: false,
    );
  }
}
