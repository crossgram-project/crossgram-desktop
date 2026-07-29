#include "crossgram/e2e.h"

#include <QtWidgets/QApplication>
#include <QtWidgets/QLabel>
#include <QtWidgets/QLineEdit>
#include <QtWidgets/QPushButton>
#include <QtWidgets/QVBoxLayout>
#include <QtWidgets/QWidget>

int main(int argc, char *argv[]) {
	QApplication application(argc, argv);
	QWidget window;
	auto layout = new QVBoxLayout(&window);
	auto input = new QLineEdit(&window);
	auto send = new QPushButton(QStringLiteral("Send"), &window);
	auto status = new QLabel(QStringLiteral("idle"), &window);
	input->setAccessibleName(QStringLiteral("Message"));
	send->setAccessibleName(QStringLiteral("Send"));
	layout->addWidget(input);
	layout->addWidget(send);
	layout->addWidget(status);
	QObject::connect(send, &QPushButton::clicked, &window, [=] {
		status->setText(QStringLiteral("sent:") + input->text());
	});
	window.show();
	Crossgram::E2e::Start();
	return application.exec();
}
