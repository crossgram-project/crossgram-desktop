
	_server->entity()->setTextTransform(Ui::RoundButtonTextTransform::ToUpper);
	_server->entity()->setClickedCallback([=] {
		_serverMenu = base::make_unique_q<Ui::PopupMenu>(
			this,
			st::defaultPopupMenu);
		Crossgram::ServerSwitch::FillMenu(
			_serverMenu.get(),
			getData()->controller,
			_account);
		_serverMenu->popup(QCursor::pos());
	});
