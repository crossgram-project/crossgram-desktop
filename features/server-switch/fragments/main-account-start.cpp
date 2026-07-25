void Account::start(std::unique_ptr<MTP::Config> config) {
	_appConfig = std::make_unique<AppConfig>(this);
	auto prepared = config
		? std::move(config)
		: std::make_unique<MTP::Config>(
			Core::App().fallbackProductionConfig());
	auto error = QString();
	if (!Crossgram::ServerSwitch::ApplyStored(
			_local->serverSwitchConfigPath(),
			&prepared->dcOptions(),
			&error)) {
		LOG(("Server Switch Error: %1").arg(error));
		prepared->dcOptions().useBuiltInConfiguration();
	}
	startMtp(std::move(prepared));
	_appConfig->start();
	watchProxyChanges();
	watchSessionChanges();
}
