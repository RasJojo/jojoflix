import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Navigation layout rules:
/// - Top bar on desktop/tablet layouts.
/// - Bottom bar on iOS/Android.
/// - Bottom bar when viewport is narrow (responsive).
class MainScaffold extends StatelessWidget {
  final Widget child;
  final int selectedIndex;

  const MainScaffold({
    super.key,
    required this.child,
    required this.selectedIndex,
  });

  static const _destinations = [
    (
      icon: Icons.home_outlined,
      activeIcon: Icons.home,
      label: 'Accueil',
      route: '/home'
    ),
    (
      icon: Icons.search_outlined,
      activeIcon: Icons.search,
      label: 'Recherche',
      route: '/search'
    ),
    (
      icon: Icons.person_outline,
      activeIcon: Icons.person,
      label: 'Profil',
      route: '/profiles'
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.of(context).size.width;
    final isMobilePlatform = defaultTargetPlatform == TargetPlatform.iOS ||
        defaultTargetPlatform == TargetPlatform.android;
    final isNarrowLayout = width < 920;

    if (isMobilePlatform || isNarrowLayout) {
      return _buildBottomNavigationScaffold(context);
    }

    return _buildTopNavigationScaffold(context);
  }

  List<NavigationDestination> _navigationDestinations() {
    return _destinations
        .map(
          (d) => NavigationDestination(
            icon: Icon(d.icon),
            selectedIcon: Icon(d.activeIcon),
            label: d.label,
          ),
        )
        .toList();
  }

  Scaffold _buildTopNavigationScaffold(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          SafeArea(
            bottom: false,
            child: NavigationBar(
              selectedIndex: selectedIndex,
              onDestinationSelected: (i) => context.go(_destinations[i].route),
              destinations: _navigationDestinations(),
            ),
          ),
          const Divider(height: 1, color: Colors.black26),
          Expanded(child: child),
        ],
      ),
    );
  }

  Scaffold _buildBottomNavigationScaffold(BuildContext context) {
    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: selectedIndex,
        onDestinationSelected: (i) => context.go(_destinations[i].route),
        destinations: _navigationDestinations(),
      ),
    );
  }
}
