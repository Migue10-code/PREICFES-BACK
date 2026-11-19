ALTER TABLE Usuarios
ADD CONSTRAINT uq_usuarios_correo UNIQUE (Correo);