# JojoFlix — commandes de développement
# Usage: make start

FRONTEND_HOST := 192.168.1.143
API_BASE_URL ?= https://jojoflixapi.jojoserv.com

.PHONY: start stop build-front build-back restart logs

## Lance tout : build front + docker compose up
start: build-front
	@echo ">>> Démarrage des services Docker..."
	docker compose up -d
	@echo ""
	@echo "✓ JojoFlix disponible sur http://$(FRONTEND_HOST)"

## Arrête tous les services
stop:
	docker compose down

## Build le frontend Flutter avec la bonne URL
build-front:
	@echo ">>> Build Flutter web (API_BASE_URL=$(API_BASE_URL))..."
	cd jojoflix_app && flutter build web --dart-define=API_BASE_URL=$(API_BASE_URL)
	@echo ">>> Build Flutter terminé."

## Rebuild le backend Docker
build-back:
	@echo ">>> Rebuild backend Docker..."
	docker compose build api migrator
	docker compose up -d api
	docker compose restart nginx

## Rebuild tout (front + back)
rebuild: build-front build-back
	docker compose restart nginx

## Voir les logs
logs:
	docker compose logs -f api

## Restart rapide (sans rebuild)
restart:
	docker compose restart
	@echo "✓ Services redémarrés sur http://$(FRONTEND_HOST)"
