

bool Account::reloadServerSwitchConfiguration(QString *error) {
	if (sessionExists()) {
		if (error) {
			*error = u"Server can only be changed before signing in."_q;
		}
		return false;
	}
	auto config = std::make_unique<MTP::Config>(_mtp->config());
	if (!Crossgram::ServerSwitch::ApplyStored(
			_local->serverSwitchConfigPath(),
			&config->dcOptions(),
			error)) {
		return false;
	}

	_mtpForKeysDestroy = nullptr;
	_mtpKeysToDestroy.clear();
	_mtpFields.keys.clear();
	_mtpFields.mainDcId = MTP::Instance::Fields::kDefaultMainDc;
	_mtp = nullptr;
	startMtp(std::move(config));
	local().writeMtpData();
	local().writeMtpConfig();
	return true;
}
