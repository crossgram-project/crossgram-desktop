
	[[nodiscard]] bool specialConfigEnabled() const;
	[[nodiscard]] bool useCustomConfiguration(
		const std::vector<Endpoint> &endpoints,
		const QByteArray &rsaKey,
		bool enableSpecialConfig);
	void useBuiltInConfiguration();
