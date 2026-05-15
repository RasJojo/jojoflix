import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/tv/tv_detector.dart';

class MainScaffold extends StatelessWidget {
  final Widget child;
  final int selectedIndex;

  const MainScaffold({
    super.key,
    required this.child,
    required this.selectedIndex,
  });

  // Desktop top nav — 5 items, index matches selectedIndex from router
  static const _desktopDestinations = [
    (label: 'Accueil', route: '/home'),
    (label: 'Films', route: '/browse/movie'),
    (label: 'Séries', route: '/browse/tv'),
    (label: 'Recherche', route: '/search'),
    (label: 'Mon Profil', route: '/profiles'),
  ];

  // Mobile bottom nav — 3 items
  static const _mobileDestinations = [
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
      label: 'Mon Profil',
      route: '/profiles'
    ),
  ];

  // selectedIndex (5 items desktop, -1 = no active) → mobile index (3 items)
  int _mobileIndex() {
    if (selectedIndex < 0) return 0;
    if (selectedIndex == 3) return 1;
    if (selectedIndex == 4) return 2;
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.of(context).size.width;
    final isTV = isTVDevice(context);
    final isMobilePlatform = !isTV &&
        (defaultTargetPlatform == TargetPlatform.iOS ||
            defaultTargetPlatform == TargetPlatform.android);
    final isNarrowLayout = width < 920;

    if (isMobilePlatform || isNarrowLayout) {
      return _buildBottomNav(context);
    }
    return _buildDesktopNav(context);
  }

  Widget _buildDesktopNav(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          _DesktopTopBar(
            selectedIndex: selectedIndex,
            destinations: _desktopDestinations
                .map((d) => (label: d.label, route: d.route))
                .toList(),
            onTap: (i) => context.go(_desktopDestinations[i].route),
          ),
          Expanded(child: child),
        ],
      ),
    );
  }

  Widget _buildBottomNav(BuildContext context) {
    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _mobileIndex(),
        onDestinationSelected: (i) =>
            context.go(_mobileDestinations[i].route),
        destinations: _mobileDestinations
            .map((d) => NavigationDestination(
                  icon: Icon(d.icon),
                  selectedIcon: Icon(d.activeIcon),
                  label: d.label,
                ))
            .toList(),
      ),
    );
  }
}

class _DesktopTopBar extends StatelessWidget {
  final int selectedIndex;
  final List<({String label, String route})> destinations;
  final void Function(int) onTap;

  const _DesktopTopBar({
    required this.selectedIndex,
    required this.destinations,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 64,
      decoration: const BoxDecoration(
        color: Color(0xFF0A0A0A),
        border: Border(
          bottom: BorderSide(color: Color(0xFF1F1F1F), width: 1),
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
          child: Row(
            children: [
              // Logo
              const Text(
                'JOJOFLIX',
                style: TextStyle(
                  color: AppColors.primary,
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 3,
                ),
              ),
              const SizedBox(width: AppSpacing.xl),

              // Nav links
              Expanded(
                child: Row(
                  children: [
                    for (int i = 0; i < destinations.length; i++)
                      _NavLink(
                        label: destinations[i].label,
                        isActive: i == selectedIndex,
                        onTap: () => onTap(i),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavLink extends StatefulWidget {
  final String label;
  final bool isActive;
  final VoidCallback onTap;

  const _NavLink({
    required this.label,
    required this.isActive,
    required this.onTap,
  });

  @override
  State<_NavLink> createState() => _NavLinkState();
}

class _NavLinkState extends State<_NavLink> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final color = widget.isActive
        ? AppColors.textPrimary
        : _hovered
            ? AppColors.textPrimary.withValues(alpha: 0.85)
            : AppColors.textSecondary;

    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      cursor: SystemMouseCursors.click,
      child: GestureDetector(
        onTap: widget.onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md, vertical: AppSpacing.sm),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              AnimatedDefaultTextStyle(
                duration: const Duration(milliseconds: 150),
                style: TextStyle(
                  color: color,
                  fontSize: 14,
                  fontWeight: widget.isActive
                      ? FontWeight.w600
                      : FontWeight.w400,
                ),
                child: Text(widget.label),
              ),
              const SizedBox(height: 3),
              AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                height: 2,
                width: widget.isActive ? 20 : 0,
                decoration: BoxDecoration(
                  color: AppColors.primary,
                  borderRadius: BorderRadius.circular(1),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
